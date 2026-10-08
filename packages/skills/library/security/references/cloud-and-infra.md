# Cloud and infrastructure basics

The configuration mistakes that turn an application bug into a full
compromise, and the ones that are breaches by themselves: over-broad IAM,
public storage, exposed ports, containers running as root with secrets in
layers, Kubernetes defaults, and infrastructure code nobody scanned. This
is the application engineer's view of infrastructure security: enough to
make the defaults safe and to recognize what needs a platform team.

## Contents

1. Principles that transfer across clouds
2. IAM least privilege: patterns and anti-patterns
3. Storage: buckets and blobs
4. Network exposure: security groups, firewalls, and "internal"
5. Instance metadata and workload identity
6. Container hardening: the Dockerfile
7. Container runtime and orchestration
8. Kubernetes basics
9. Infrastructure as code scanning
10. Logging, alerting, and the signals that matter
11. Serverless specifics
12. Detection and verification commands

## 1. Principles that transfer across clouds

- **Identity is the perimeter.** Network boundaries still matter, but a
  leaked credential bypasses them. Design so that any single credential
  can do little.
- **Deny by default, allow by exception**, for IAM policies, security
  groups, bucket policies, and Kubernetes network policies alike.
- **Short-lived credentials over static keys** (roles, workload identity,
  OIDC federation). Static keys are for the cases where nothing else is
  possible, with rotation.
- **Environment separation**: separate accounts/projects/subscriptions for
  prod, staging, dev. A compromised dev key should not reach prod data.
- **Everything as code, scanned in CI**: a Terraform plan with a public
  bucket is caught in review; a console click is caught never.
- **Audit logs on, centralized, and read by something.** CloudTrail / Cloud
  Audit Logs / Activity Log with alerts on the handful of events that
  matter (§10).
- **Encryption at rest is table stakes and mostly a checkbox** (managed
  keys); the design question is who can read via IAM, not whether disks
  are encrypted.

## 2. IAM least privilege

Anti-patterns that appear in nearly every audit:

```json
// WRONG: the application role can do anything to anything
{ "Effect": "Allow", "Action": "*", "Resource": "*" }
// WRONG: service wildcard, still far too broad
{ "Effect": "Allow", "Action": "s3:*", "Resource": "*" }
// WRONG: admin role attached to an EC2 instance "to make it work"
```

```json
// RIGHT: specific actions on specific resources, with conditions where they help
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteOwnUploads",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::acme-prod-uploads/*"
    },
    {
      "Sid": "ListOwnBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::acme-prod-uploads",
      "Condition": { "StringLike": { "s3:prefix": ["tenants/*"] } }
    },
    {
      "Sid": "DecryptWithAppKey",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/<key-id>"
    },
    {
      "Sid": "ReadOwnSecrets",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/api/*"
    }
  ]
}
```

Patterns:

- **One role per workload** (API, worker, cron, CI deploy), each with only
  its actions. Shared "app role" grows forever.
- **Resource ARNs, not `*`**, wherever the service supports resource-level
  permissions. Where it does not (some `Describe*`/`List*` actions), scope
  with conditions (`aws:ResourceTag`, `aws:RequestedRegion`).
- **Permission boundaries / SCPs (AWS), organization policies (GCP),
  Azure Policy** to cap what any role in an account can do, so a
  misconfigured role cannot become admin.
- **Generate from usage**: AWS IAM Access Analyzer "generate policy" from
  CloudTrail, GCP IAM Recommender, Azure's "least privilege" suggestions
  shrink existing over-broad roles with evidence.
- **No long-lived IAM user keys for humans** (SSO with MFA) or for
  workloads (roles). Alarm on `CreateAccessKey`.
- **Deny dangerous privilege escalation paths**: `iam:PassRole` with `*`,
  `iam:CreatePolicyVersion`, `iam:AttachUserPolicy`, `sts:AssumeRole` on
  broad resources, `lambda:UpdateFunctionCode` on functions with
  privileged roles. Tools like `pmapper`, `cloudsplaining`, and
  `prowler` find these.
- **Cross-account access**: external ids on assume-role trust policies;
  never a trust policy with `"Principal": "*"`.
- **GCP**: avoid primitive roles (`roles/owner`, `roles/editor`) on
  projects; use predefined or custom roles on specific resources; avoid
  service account key files (use workload identity / impersonation);
  `roles/iam.serviceAccountUser` on a project is a privilege escalation
  path.
- **Azure**: scope role assignments to resource groups or resources, not
  subscriptions; managed identities over service principals with secrets;
  watch `Owner` and `User Access Administrator`.

## 3. Storage: buckets and blobs

Public buckets are still the most common cloud data breach. The fix is a
few settings at the account level plus a habit.

**AWS S3**: enable **Block Public Access at the account level** (all four
settings), which overrides any bucket policy or ACL that would grant public
access; disable ACLs (`BucketOwnerEnforced`); use bucket policies for
cross-account access with specific principals; enable default encryption
(SSE-S3 or SSE-KMS); enable versioning and, for sensitive data, Object
Lock or MFA delete; enable server access logging or CloudTrail data events
for buckets with sensitive data; serve public assets via CloudFront with
Origin Access Control instead of a public bucket.

```hcl
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "aws:kms"; kms_master_key_id = aws_kms_key.uploads.arn } }
}
```

**GCP Cloud Storage**: enforce **public access prevention** at the
organization or project level; use **uniform bucket-level access** (no
object ACLs); never grant `allUsers` or `allAuthenticatedUsers`
(`allAuthenticatedUsers` means any Google account on Earth, not your
organization).

**Azure Blob**: disable anonymous blob access at the storage account
(`allowBlobPublicAccess = false`); use private endpoints; shared access
signatures (SAS) with short expiry, minimal permissions, and stored access
policies so they can be revoked; prefer Entra ID auth over account keys
and rotate the keys.

For user files, signed URLs with minutes of validity (`ssrf-and-server-side.md`
§6); for public assets, a CDN in front of a private bucket. Listing
permission (`s3:ListBucket`, `storage.objects.list`) on a bucket of
user files lets anyone enumerate every file; grant it only to the app.

## 4. Network exposure

- Security groups / firewall rules: inbound only what is needed from where
  it is needed. `0.0.0.0/0` on 22, 3389, 5432, 3306, 6379, 27017, 9200 is a
  breach waiting for a password guess (and Redis/Mongo/Elasticsearch
  historically have no password by default). Databases and caches live in
  private subnets with security groups that allow only the app tier's
  group as source.
- Load balancers terminate TLS and are the only public thing; instances
  have no public IPs. Admin access via SSM Session Manager / IAP / Bastion
  with MFA, not public SSH.
- Egress matters too: a server that can reach the whole internet can
  exfiltrate and can be used for SSRF pivoting. Egress allowlists (NAT with
  firewall rules, VPC service controls, Network Policies in K8s) are
  advanced but valuable for the tier that handles untrusted content.
- "Internal" services still need authentication. Flat networks mean one
  compromised pod reaches every internal admin UI. Service mesh mTLS or at
  least a token per service.
- Managed databases: disable public accessibility; require TLS
  (`rds.force_ssl`, `require_secure_transport`); IAM database
  authentication where available instead of static passwords.
- DNS: dangling records pointing at deprovisioned cloud resources
  (subdomain takeover) let an attacker serve content on your domain and
  break SameSite cookie assumptions. Audit CNAMEs/A records to cloud
  hostnames periodically.

## 5. Instance metadata and workload identity

The metadata service (`169.254.169.254`) hands credentials to anything
running on the instance, including an SSRF'd web app. Hardening:

- AWS: **IMDSv2 required** (`HttpTokens = required`, hop limit 1 so
  containers cannot reach it unless intended); for ECS/EKS use task roles /
  IRSA / Pod Identity so pods get their own narrow credentials and the
  node role is minimal.
- GCP: Workload Identity on GKE; disable legacy metadata endpoints
  (`disable-legacy-endpoints=true`, default on); minimal node service
  account (not the default compute SA with Editor).
- Azure: managed identities per workload; restrict IMDS access from
  containers with network policy.
- Kubernetes: block pod egress to the metadata IP with a NetworkPolicy
  unless the pod needs it; use the identity integration instead.

## 6. Container hardening: the Dockerfile

```dockerfile
# WRONG (common): root, latest, build tools in prod image, secrets in layers, whole context copied
FROM node:latest
COPY . .
RUN npm install
ENV API_KEY=sk_live_...
CMD node server.js
```

```dockerfile
# RIGHT: pinned minimal base, multi-stage, non-root, read-only friendly, no secrets, health check
# syntax=docker/dockerfile:1
FROM node:22.11.0-alpine3.20@sha256:<digest> AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:<digest>
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /app/dist ./dist
COPY --from=build --chown=nonroot:nonroot /app/node_modules ./node_modules
COPY --from=build --chown=nonroot:nonroot /app/package.json ./
USER nonroot
ENV NODE_ENV=production
EXPOSE 8080
CMD ["dist/server.js"]
```

Rules and reasons:

- **Non-root user** (`USER` directive; distroless `:nonroot` tags; `adduser
  -D app && USER app` on Alpine/Debian). A container escape or a file-write
  bug as root is far worse than as uid 65532. Also set
  `runAsNonRoot: true` in K8s so a future image change cannot regress.
- **Minimal base**: distroless, Chainguard images, Alpine, or `scratch`
  for static binaries. Fewer packages = fewer CVEs in the scan and fewer
  tools for an attacker (no shell, no `curl`). Debian-slim when you need
  glibc compatibility.
- **Pin by digest**, update via Renovate. Tags move.
- **Multi-stage**: compilers, dev dependencies, and source do not ship.
- **No secrets in layers** (`secrets.md` §7): BuildKit `--mount=type=secret`;
  runtime injection via env/files from the orchestrator.
- **`.dockerignore`**: `.git`, `.env*`, `node_modules`, test fixtures,
  docs.
- **`COPY` specific paths**, not `COPY . .` after the build stage.
- **Read-only root filesystem** compatible: write only to `/tmp` or a
  mounted volume so you can set `readOnlyRootFilesystem: true`.
- **Health check and graceful shutdown** (SIGTERM handling) so the
  orchestrator can replace compromised or unhealthy instances.
- **One process per container**; no SSH daemon, no supervisor running
  extra services.
- **Scan**: `trivy image`, `grype`, `docker scout`; `hadolint Dockerfile`
  for the Dockerfile itself; `dockle` for runtime config.

## 7. Container runtime and orchestration

Docker/Compose/ECS/Nomad settings that matter:

- Do not run with `--privileged`; do not mount the Docker socket
  (`/var/run/docker.sock`) into a container (that is root on the host).
- Drop capabilities: `--cap-drop=ALL --cap-add=NET_BIND_SERVICE` if binding
  below 1024, otherwise bind to a high port and drop everything.
- `--read-only` with `--tmpfs /tmp`; `--security-opt=no-new-privileges`.
- Resource limits (`--memory`, `--cpus`, `--pids-limit`) so one container
  cannot starve the host.
- Seccomp and AppArmor default profiles on (they are, unless disabled;
  never `seccomp=unconfined`).
- Do not bind container ports to `0.0.0.0` on the host when only local
  access is needed; Docker bypasses host firewall rules (ufw) for
  published ports, which has exposed many databases.
- Logs to stdout/stderr, collected by the platform; no secrets in them.

## 8. Kubernetes basics

Defaults are permissive. The minimum for a production namespace:

```yaml
# Pod spec security context (per workload)
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      serviceAccountName: api                       # dedicated SA, not `default`
      automountServiceAccountToken: false           # unless the pod calls the K8s API
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        fsGroup: 65532
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: api
          image: registry.example/api@sha256:<digest>
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: "1", memory: 512Mi }
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
          envFrom:
            - secretRef: { name: api-secrets }      # synced from a real secret manager (External Secrets Operator)
      volumes:
        - { name: tmp, emptyDir: {} }
```

```yaml
# Namespace-level: Pod Security Admission enforcing the "restricted" profile
apiVersion: v1
kind: Namespace
metadata:
  name: prod
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/warn: restricted
---
# Default-deny network policy, then allow what is needed
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: prod }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-allow, namespace: prod }
spec:
  podSelector: { matchLabels: { app: api } }
  ingress:
    - from: [{ namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ingress } } }]
      ports: [{ port: 8080 }]
  egress:
    - to: [{ podSelector: { matchLabels: { app: postgres } } }]
      ports: [{ port: 5432 }]
    - to: [{ namespaceSelector: {}, podSelector: { matchLabels: { k8s-app: kube-dns } } }]
      ports: [{ port: 53, protocol: UDP }]
```

Also: RBAC with least privilege (no `cluster-admin` for workloads; audit
`ClusterRoleBinding`s; `kubectl auth can-i --list --as=system:serviceaccount:prod:api`);
Secrets encrypted at rest (`EncryptionConfiguration` with KMS) and not
committed to git in plaintext (SOPS/Sealed Secrets/External Secrets);
ingress with TLS and a WAF/rate limiter if exposed; admission policies
(Kyverno, Gatekeeper) to require digests, non-root, resource limits, and
block `hostPath`/`hostNetwork`/privileged; private cluster API endpoint or
authorized networks; node auto-upgrades; image pull from your registry
only; `kube-bench` against CIS; `kube-score`/`kubesec`/`polaris` on
manifests; `trivy k8s` for the live cluster.

## 9. Infrastructure as code scanning

Run in CI on every change to `*.tf`, CloudFormation, Pulumi, K8s
manifests, Helm charts, Dockerfiles, Ansible:

```bash
checkov -d . --framework terraform,kubernetes,dockerfile,github_actions --soft-fail-on LOW
tfsec . --minimum-severity MEDIUM          # (merged into trivy; `trivy config .` is the successor)
trivy config --severity HIGH,CRITICAL .
terrascan scan -i terraform
kics scan -p .                             # Checkmarx KICS, broad coverage
conftest test deploy/ -p policy/           # OPA Rego policies you write
```

Triage like SAST: each finding is confirmed, suppressed with a reason and
owner inline (`#checkov:skip=CKV_AWS_18:Access logging handled by org
CloudTrail data events`), or fixed. The high-signal rules: public
storage, open security groups, unencrypted storage, IAM wildcards,
missing logging, privileged containers, missing resource limits,
`latest` tags, secrets in variables.

Also scan the *state*: Terraform state contains secrets (DB passwords,
keys) in plaintext. Remote state with encryption and tight IAM; never
commit `terraform.tfstate`.

Drift: a console change that diverges from code is both an operational
and security issue. `terraform plan` on a schedule with alerts on drift,
or a cloud-side posture tool (AWS Config rules, Security Hub, GCP
Security Command Center, Azure Defender for Cloud, Prowler, ScoutSuite)
to catch what IaC scanning cannot see.

## 10. Logging, alerting, and the signals that matter

Turn on and centralize: CloudTrail (all regions, management + data events
for sensitive buckets, log file validation), VPC flow logs for sensitive
subnets, ALB/CloudFront access logs, GuardDuty / Security Command Center /
Defender; GCP Cloud Audit Logs (Admin Activity is on; enable Data Access
for sensitive services); Azure Activity Log + diagnostic settings.

Alert on the few events that nearly always matter:

- Root/owner account use; console login without MFA; new IAM user or
  access key; policy attached to a user; `AssumeRole` from an unknown
  account.
- Security group opened to `0.0.0.0/0` on a non-web port; bucket public
  access block disabled; bucket policy made public; KMS key scheduled for
  deletion; CloudTrail stopped or log bucket changed.
- GuardDuty/SCC high findings (credential exfiltration from EC2 is the one
  that fires on SSRF-to-IMDS).
- Spikes in `Decrypt`/`GetSecretValue`; secrets accessed by an unexpected
  principal.
- Kubernetes: `exec` into pods in prod, new ClusterRoleBinding, image from
  an unknown registry.
- Spend anomalies (crypto mining is the usual first symptom of a leaked
  key).

Route to a channel someone reads, with an owner. Logs nobody reads are a
retention cost, not a control. Application-level logging is in
`logging-privacy.md`.

## 11. Serverless specifics

- One IAM role per function with only its actions; the console's
  "create role with basic permissions" is fine, "full access" templates
  are not.
- Environment variables are visible to anyone with `GetFunctionConfiguration`;
  use the secret manager for real secrets, or at least KMS-encrypted env
  with the function decrypting at init.
- Function URLs / API Gateway without auth are public endpoints; set
  authorizers or IAM auth.
- Timeouts and reserved concurrency bound denial-of-wallet.
- Event sources are inputs: S3 event names, SQS message bodies, EventBridge
  payloads are all data to validate.
- Keep the deployment package small (same dependency hygiene) and scan it;
  layers are dependencies too.
- `/tmp` persists across warm invocations; do not leave secrets or user
  files there.

## 12. Detection and verification commands

```bash
# AWS: quick posture checks
aws s3api get-public-access-block --bucket <b>
aws s3api get-bucket-policy-status --bucket <b>                      # IsPublic
aws ec2 describe-security-groups --filters Name=ip-permission.cidr,Values=0.0.0.0/0 --query 'SecurityGroups[].{id:GroupId,ports:IpPermissions[].{from:FromPort,to:ToPort}}'
aws ec2 describe-instances --query 'Reservations[].Instances[].{id:InstanceId,imds:MetadataOptions.HttpTokens}'   # want "required"
aws iam get-account-authorization-details --filter Role | jq '.RoleDetailList[] | select(.RolePolicyList[]?.PolicyDocument.Statement[]?.Action == "*")'
aws iam list-users --query 'Users[].UserName' | xargs -I{} aws iam list-access-keys --user-name {}
prowler aws                                                           # full CIS/AWS best-practice scan
# GCP
gcloud storage buckets describe gs://<b> --format="value(iamConfiguration)"
gcloud projects get-iam-policy <project> --flatten="bindings[].members" --filter="bindings.role:roles/owner OR bindings.role:roles/editor"
gcloud compute firewall-rules list --filter="sourceRanges:0.0.0.0/0" --format="table(name,allowed[].ports)"
# Azure
az storage account list --query "[].{name:name,public:allowBlobPublicAccess}"
az network nsg rule list --nsg-name <nsg> -g <rg> --query "[?sourceAddressPrefix=='*' && access=='Allow']"
# Containers
hadolint Dockerfile
trivy image --severity HIGH,CRITICAL --ignore-unfixed registry/app:tag
docker run --rm -it registry/app:tag id            # should not be uid 0 (if a shell exists at all)
dockle registry/app:tag
# Kubernetes
kubectl get pods -A -o json | jq -r '.items[] | select(.spec.containers[].securityContext.privileged==true or .spec.hostNetwork==true or .spec.hostPID==true) | .metadata.namespace+"/"+.metadata.name'
kubectl get clusterrolebindings -o json | jq -r '.items[] | select(.roleRef.name=="cluster-admin") | .subjects[]?.name'
kubectl auth can-i --list --as=system:serviceaccount:prod:api
kube-bench run
# IaC
checkov -d . ; trivy config .
```

Cross-references: SSRF to metadata in `ssrf-and-server-side.md`; secret
injection and rotation in `secrets.md`; image and action pinning in
`dependencies-supply-chain.md`; application logging in
`logging-privacy.md`.
