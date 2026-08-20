const weatherCodes: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export const definition = {
  name: 'get_weather',
  description: 'Get the current weather for a given city. Returns temperature, humidity, wind speed, and conditions.',
  input_schema: {
    type: 'object' as const,
    properties: {
      city: {
        type: 'string',
        description: 'The city name to get weather for (e.g., "New York", "London", "Tokyo")',
      },
    },
    required: ['city'],
  },
};

export async function execute(input: { city: string }) {
  try {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input.city)}&count=1`;
    const geoResponse = await fetch(geoUrl);
    const geoData: any = await geoResponse.json();

    if (!geoData.results || geoData.results.length === 0) {
      return { error: `Could not find location: ${input.city}` };
    }

    const { latitude, longitude, name, country } = geoData.results[0];

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&temperature_unit=fahrenheit`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData: any = await weatherResponse.json();

    const current = weatherData.current;
    const weatherCode = current.weather_code as number;

    return {
      city: name,
      country,
      temperature: `${current.temperature_2m}°F`,
      humidity: `${current.relative_humidity_2m}%`,
      windSpeed: `${current.wind_speed_10m} mph`,
      condition: weatherCodes[weatherCode] || 'Unknown',
    };
  } catch (error: any) {
    return { error: `Weather lookup failed: ${error.message}` };
  }
}
