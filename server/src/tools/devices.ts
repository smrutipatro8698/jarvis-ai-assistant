import { DeviceState } from '../types';

const devices: DeviceState[] = [
  {
    id: 'living_room_lights',
    name: 'Living Room Lights',
    type: 'light',
    state: { on: true, brightness: 80, color: 'warm white' },
  },
  {
    id: 'bedroom_lights',
    name: 'Bedroom Lights',
    type: 'light',
    state: { on: false, brightness: 50, color: 'warm white' },
  },
  {
    id: 'thermostat',
    name: 'Thermostat',
    type: 'thermostat',
    state: { temperature: 72, mode: 'auto', humidity: 45 },
  },
  {
    id: 'front_door',
    name: 'Front Door',
    type: 'lock',
    state: { locked: true, lastActivity: '2 hours ago' },
  },
  {
    id: 'kitchen_speaker',
    name: 'Kitchen Speaker',
    type: 'speaker',
    state: { playing: false, volume: 40 },
  },
];

export const controlDeviceDefinition = {
  name: 'control_device',
  description: 'Control a smart home device. Can turn devices on/off, adjust brightness, set temperature, lock/unlock doors, and control speakers.',
  input_schema: {
    type: 'object' as const,
    properties: {
      device: {
        type: 'string',
        description: 'The device name or partial match (e.g., "living room", "thermostat", "front door")',
      },
      action: {
        type: 'string',
        description: 'The action to perform (e.g., "turn on", "turn off", "set brightness to 50", "set temperature to 70", "lock", "unlock", "play music", "set volume to 60")',
      },
    },
    required: ['device', 'action'],
  },
};

export const getDevicesDefinition = {
  name: 'get_devices',
  description: 'Get the current state of all smart home devices.',
  input_schema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

function findDevice(query: string): DeviceState | undefined {
  const lower = query.toLowerCase();
  return devices.find(
    (d) =>
      d.name.toLowerCase().includes(lower) ||
      d.id.toLowerCase().includes(lower)
  );
}

function parseAction(device: DeviceState, action: string): string {
  const lower = action.toLowerCase();

  if (device.type === 'light') {
    if (lower.includes('turn on') || lower === 'on') {
      device.state.on = true;
      return `${device.name} turned on`;
    }
    if (lower.includes('turn off') || lower === 'off') {
      device.state.on = false;
      return `${device.name} turned off`;
    }
    const brightnessMatch = lower.match(/(?:set\s+)?brightness\s+(?:to\s+)?(\d+)/);
    if (brightnessMatch) {
      const val = Math.min(100, Math.max(0, parseInt(brightnessMatch[1])));
      device.state.brightness = val;
      return `${device.name} brightness set to ${val}%`;
    }
    const colorMatch = lower.match(/(?:set\s+)?color\s+(?:to\s+)?(.+)/);
    if (colorMatch) {
      device.state.color = colorMatch[1].trim();
      return `${device.name} color set to ${device.state.color}`;
    }
  }

  if (device.type === 'thermostat') {
    const tempMatch = lower.match(/(?:set\s+)?temp(?:erature)?\s+(?:to\s+)?(\d+)/);
    if (tempMatch) {
      device.state.temperature = parseInt(tempMatch[1]);
      return `Thermostat set to ${device.state.temperature}°F`;
    }
    const modeMatch = lower.match(/(?:set\s+)?mode\s+(?:to\s+)?(\w+)/);
    if (modeMatch) {
      device.state.mode = modeMatch[1];
      return `Thermostat mode set to ${device.state.mode}`;
    }
  }

  if (device.type === 'lock') {
    if (lower.includes('lock') && !lower.includes('unlock')) {
      device.state.locked = true;
      device.state.lastActivity = 'Just now';
      return `${device.name} locked`;
    }
    if (lower.includes('unlock')) {
      device.state.locked = false;
      device.state.lastActivity = 'Just now';
      return `${device.name} unlocked`;
    }
  }

  if (device.type === 'speaker') {
    if (lower.includes('play')) {
      device.state.playing = true;
      return `${device.name} now playing`;
    }
    if (lower.includes('stop') || lower.includes('pause')) {
      device.state.playing = false;
      return `${device.name} stopped`;
    }
    const volumeMatch = lower.match(/(?:set\s+)?volume\s+(?:to\s+)?(\d+)/);
    if (volumeMatch) {
      device.state.volume = Math.min(100, Math.max(0, parseInt(volumeMatch[1])));
      return `${device.name} volume set to ${device.state.volume}`;
    }
  }

  // Generic on/off for any device
  if (lower.includes('turn on') || lower === 'on') {
    device.state.on = true;
    return `${device.name} turned on`;
  }
  if (lower.includes('turn off') || lower === 'off') {
    device.state.on = false;
    return `${device.name} turned off`;
  }

  return `Unrecognized action "${action}" for ${device.name}`;
}

export async function executeControlDevice(input: { device: string; action: string }) {
  try {
    const device = findDevice(input.device);
    if (!device) {
      return {
        error: `Device not found: "${input.device}". Available devices: ${devices.map((d) => d.name).join(', ')}`,
      };
    }

    const message = parseAction(device, input.action);
    return {
      message,
      device: {
        id: device.id,
        name: device.name,
        type: device.type,
        state: { ...device.state },
      },
    };
  } catch (error: any) {
    return { error: `Device control failed: ${error.message}` };
  }
}

export async function executeGetDevices() {
  return {
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      state: { ...d.state },
    })),
  };
}
