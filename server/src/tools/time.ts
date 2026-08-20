export const definition = {
  name: 'get_time',
  description: 'Get the current time and date, optionally in a specific timezone.',
  input_schema: {
    type: 'object' as const,
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone identifier (e.g., "America/New_York", "Europe/London", "Asia/Tokyo"). Defaults to UTC.',
      },
    },
    required: [],
  },
};

export async function execute(input: { timezone?: string }) {
  try {
    const tz = input.timezone || 'UTC';
    const now = new Date();

    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
    });

    return {
      time: timeFormatter.format(now),
      date: dateFormatter.format(now),
      timezone: tz,
      dayOfWeek: dayFormatter.format(now),
    };
  } catch (error: any) {
    return { error: `Time lookup failed: ${error.message}` };
  }
}
