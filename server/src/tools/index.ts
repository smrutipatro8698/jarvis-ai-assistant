import { definition as weatherDef, execute as weatherExec } from './weather';
import { definition as timeDef, execute as timeExec } from './time';
import { definition as calculateDef, execute as calculateExec } from './calculate';
import {
  setReminderDefinition,
  getReminderDefinition,
  executeSetReminder,
  executeGetReminders,
} from './reminders';
import { definition as systemDef, execute as systemExec } from './system';
import {
  controlDeviceDefinition,
  getDevicesDefinition,
  executeControlDevice,
  executeGetDevices,
} from './devices';
import { definition as newsDef, execute as newsExec } from './news';
import { definition as webSearchDef, execute as webSearchExec } from './web-search';
import { definition as readWebpageDef, execute as readWebpageExec } from './read-webpage';

interface ToolEntry {
  definition: any;
  execute: (input: any) => Promise<any>;
}

const toolRegistry: Record<string, ToolEntry> = {
  get_weather: { definition: weatherDef, execute: weatherExec },
  get_time: { definition: timeDef, execute: timeExec },
  calculate: { definition: calculateDef, execute: calculateExec },
  set_reminder: { definition: setReminderDefinition, execute: executeSetReminder },
  get_reminders: { definition: getReminderDefinition, execute: executeGetReminders },
  system_status: { definition: systemDef, execute: systemExec },
  control_device: { definition: controlDeviceDefinition, execute: executeControlDevice },
  get_devices: { definition: getDevicesDefinition, execute: executeGetDevices },
  get_news: { definition: newsDef, execute: newsExec },
  web_search: { definition: webSearchDef, execute: webSearchExec },
  read_webpage: { definition: readWebpageDef, execute: readWebpageExec },
};

export function getAllToolDefinitions() {
  return Object.values(toolRegistry).map((entry) => entry.definition);
}

export async function executeTool(name: string, input: any): Promise<any> {
  const entry = toolRegistry[name];
  if (!entry) {
    return { error: `Unknown tool: ${name}` };
  }
  return entry.execute(input);
}
