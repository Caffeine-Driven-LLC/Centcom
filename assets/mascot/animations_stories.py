"""Long-form 'story' animations: existing animations chained into one continuous scene."""
from animations import ANIMS, reg

_BY = {a['name']: a for a in ANIMS}

STORIES = {
    'story_coding_session': ('ready_prompt typing compiling tests_failing debugging typing tests_passing celebrate', 'A whole coding session, start to celebration.'),
    'story_bug_hunt': ('typing debugging bug_squash thinking_hard rubber_duck typing tests_passing thumbs_up', 'Finding and squashing a bug.'),
    'story_deploy_day': ('git_commit git_push ci_running ci_passed deploy first_deploy', 'From commit to production.'),
    'story_ci_drama': ('ci_running ci_failed panic facepalm hotfix ci_running ci_passed', 'CI goes red, then green.'),
    'story_bedtime': ('yawn dozing_sitting sleeping dreaming wake_up stretch coffee_sip', 'Night and morning.'),
    'story_morning_routine': ('wake_up stretch coffee_refuel ready_prompt typing', 'Coffee first.'),
    'story_agent_task': ('prompt_received thinking plan_mode tool_running streaming_response accept_edits session_saved', 'An agent handles a request.'),
    'story_agent_hiccup': ('tool_running error permission_prompt tool_deny asking_question tool_approve tool_running', 'A tool call gets blocked, then approved.'),
    'story_file_ops': ('creating_file editing_file file_saved moving_file deleting_file', 'Everything you can do to a file.'),
    'story_connection_loss': ('offline reconnecting back_online session_expired auth_needed logged_in', 'Offline, back online, signed in again.'),
    'story_first_run': ('first_run_welcome empty_state new_session ready_prompt prompt_typing first_commit', 'First launch to first commit.'),
    'story_billing': ('token_counter cost_alert quota_reached upgrade_pro payment_success', 'Usage, limits, upgrade.'),
    'story_new_teammate': ('invite welcome wave_hello chat dap_up cheers hug', 'A teammate joins and gets a warm welcome.'),
    'story_rollercoaster': ('happy excited surprised confused worried scared sad crying grateful love happy', 'Every mood in a row.'),
    'story_party': ('celebrate party fireworks victory_dance trophy gg', 'Victory lap.'),
    'story_dance_floor': ('dance disco headphones_vibe juggle dance', 'Music on.'),
    'story_night_owl': ('coffee_refuel typing_fast tired nap_at_desk wake_up coffee_sip typing', 'One more commit before bed.'),
    'story_release_train': ('pr_open pr_review_requested pr_approved pr_merged release_tag ci_passed', 'PR to release.'),
    'story_security_scare': ('security_scan vulnerability_found panic hotfix permission_granted', 'A vulnerability, found and fixed.'),
    'story_make_up': ('sad apologize hug thank_you', 'Sorry, hug, thanks.'),
}
for name, (seq, desc) in STORIES.items():
    frames = []
    for n in seq.split():
        frames += _BY[n]['frames']
    reg('stories', name, frames, desc)
