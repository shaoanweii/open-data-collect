type TaskAction = "running" | "paused" | "deleted";

type TaskState = {
  action: TaskAction;
  controller: AbortController;
};

const taskControls = new Map<string, TaskState>();
const signalStates = new WeakMap<AbortSignal, TaskState>();

export class TaskControlError extends Error {
  action: Exclude<TaskAction, "running">;

  constructor(action: Exclude<TaskAction, "running">) {
    super(action === "paused" ? "任务已暂停" : "任务已删除");
    this.name = "TaskControlError";
    this.action = action;
  }
}

export const taskControl = {
  begin(taskId: string) {
    const previous = taskControls.get(taskId);
    if (previous) {
      previous.action = "deleted";
      previous.controller.abort();
    }
    const state: TaskState = {
      action: "running",
      controller: new AbortController(),
    };
    taskControls.set(taskId, state);
    signalStates.set(state.controller.signal, state);
    return state.controller.signal;
  },

  pause(taskId: string) {
    const state = taskControls.get(taskId);
    if (state) {
      state.action = "paused";
      state.controller.abort();
      return;
    }
    const pausedState: TaskState = {
      action: "paused",
      controller: new AbortController(),
    };
    taskControls.set(taskId, pausedState);
    signalStates.set(pausedState.controller.signal, pausedState);
  },

  delete(taskId: string) {
    const state = taskControls.get(taskId);
    if (state) {
      state.action = "deleted";
      state.controller.abort();
      return;
    }
    const deletedState: TaskState = {
      action: "deleted",
      controller: new AbortController(),
    };
    taskControls.set(taskId, deletedState);
    signalStates.set(deletedState.controller.signal, deletedState);
  },

  complete(taskId: string) {
    taskControls.delete(taskId);
  },

  signal(taskId: string) {
    return taskControls.get(taskId)?.controller.signal;
  },

  assertActive(taskId: string, signal?: AbortSignal) {
    const state = signal ? signalStates.get(signal) : taskControls.get(taskId);
    if (!state) {
      return;
    }
    if (state.action === "paused" || state.action === "deleted") {
      throw new TaskControlError(state.action);
    }
    if (state.controller.signal.aborted) {
      throw new TaskControlError("paused");
    }
  },
};
