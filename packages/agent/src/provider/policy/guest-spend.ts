export interface GuestSpendDeps { /** Connected editors other than the host. */ guests(): number; /** Implemented by the session lanes with `control.policy` (locked: true) and by holding unclaimed guest queue items. */ setGuestsPaused(paused: boolean): void }
export function createGuestSpendControl(d: GuestSpendDeps) {
  let paused = false;
  return {
    count: (): number => Math.max(0, d.guests()),
    paused: (): boolean => paused,
    pause(): void { if (paused) return; paused = true; d.setGuestsPaused(true); },
    resume(): void { if (!paused) return; paused = false; d.setGuestsPaused(false); },
  };
}
export type GuestSpendControl = ReturnType<typeof createGuestSpendControl>;
