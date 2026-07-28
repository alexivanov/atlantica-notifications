import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { refreshAndArm } from './notifications';
import { syncWidgetData } from './widget';

/**
 * Periodic re-arm while the app is backgrounded.
 *
 * Reminders are capped (iOS keeps only the soonest 64 pending local
 * notifications), so the armed window covers the next few days rather than the
 * whole schedule. This task tops it up and picks up schedule changes.
 *
 * iOS decides when this actually runs, and may never run it if the app is
 * rarely opened -- so it is a top-up, never the only path. Opening the app
 * always re-arms too.
 */

export const REARM_TASK = 'atlantica-rearm-reminders';

TaskManager.defineTask(REARM_TASK, async () => {
  try {
    const result = await refreshAndArm();
    await syncWidgetData();
    console.log(
      `[bg] re-armed ${result.scheduled} reminders` +
        (result.fromCache ? ' (from cache)' : ''),
    );
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.warn('[bg] re-arm failed:', (err as Error).message);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundRearm(): Promise<void> {
  try {
    const already = await TaskManager.isTaskRegisteredAsync(REARM_TASK);
    if (already) return;
    await BackgroundTask.registerTaskAsync(REARM_TASK, {
      // The OS floor is 15 minutes; asking for hourly is honest about what we
      // need and reduces the chance iOS throttles us for being greedy.
      minimumInterval: 60,
    });
  } catch (err) {
    // Not fatal: foreground re-arming still covers the common case.
    console.warn('[bg] could not register task:', (err as Error).message);
  }
}
