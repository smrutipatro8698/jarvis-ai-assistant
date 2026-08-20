interface Reminder {
  id: string;
  message: string;
  createdAt: Date;
  triggerAt: Date;
  fired: boolean;
}

const reminders: Reminder[] = [];
let nextId = 1;

export const setReminderDefinition = {
  name: 'set_reminder',
  description: 'Set a reminder that will trigger after a specified number of minutes.',
  input_schema: {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'The reminder message',
      },
      minutes: {
        type: 'number',
        description: 'Number of minutes from now until the reminder triggers',
      },
    },
    required: ['message', 'minutes'],
  },
};

export const getReminderDefinition = {
  name: 'get_reminders',
  description: 'Get all active reminders with their status and time remaining.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function executeSetReminder(input: { message: string; minutes: number }) {
  try {
    const id = `reminder_${nextId++}`;
    const now = new Date();
    const triggerAt = new Date(now.getTime() + input.minutes * 60 * 1000);

    const reminder: Reminder = {
      id,
      message: input.message,
      createdAt: now,
      triggerAt,
      fired: false,
    };

    reminders.push(reminder);

    setTimeout(() => {
      reminder.fired = true;
      console.log(`[REMINDER FIRED] ${reminder.message}`);
    }, input.minutes * 60 * 1000);

    return {
      id,
      message: input.message,
      triggerAt: triggerAt.toISOString(),
      minutesFromNow: input.minutes,
      status: 'Reminder set successfully',
    };
  } catch (error: any) {
    return { error: `Failed to set reminder: ${error.message}` };
  }
}

export async function executeGetReminders() {
  try {
    const now = new Date();
    const activeReminders = reminders.map((r) => {
      const msRemaining = r.triggerAt.getTime() - now.getTime();
      const minutesRemaining = Math.max(0, Math.round(msRemaining / 60000));

      return {
        id: r.id,
        message: r.message,
        createdAt: r.createdAt.toISOString(),
        triggerAt: r.triggerAt.toISOString(),
        fired: r.fired,
        minutesRemaining: r.fired ? 0 : minutesRemaining,
      };
    });

    return {
      count: activeReminders.length,
      reminders: activeReminders,
    };
  } catch (error: any) {
    return { error: `Failed to get reminders: ${error.message}` };
  }
}
