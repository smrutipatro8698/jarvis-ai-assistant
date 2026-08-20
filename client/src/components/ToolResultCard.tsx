export interface ToolResult {
  name: string;
  result: Record<string, unknown>;
  displayType: string;
}

interface ToolResultCardProps {
  result: ToolResult;
}

function WeatherCard({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="tool-card__body">
      <div className="tool-card--weather">
        <div className="tool-card__city">
          {(result.city as string) || 'Unknown'}
        </div>
        <div className="tool-card__temp">
          {(result.temperature as string) || (result.temp as string) || '--'}
        </div>
        <div className="tool-card__conditions">
          {(result.conditions as string) || (result.description as string) || ''}
        </div>
        <div className="tool-card__details">
          {result.humidity != null && <span>Humidity: {String(result.humidity)}</span>}
          {result.wind != null && <span>Wind: {String(result.wind)}</span>}
        </div>
      </div>
    </div>
  );
}

function TimeCard({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="tool-card__body">
      <div className="tool-card--time">
        <div className="tool-card__time-display">
          {(result.time as string) || '--:--'}
        </div>
        <div className="tool-card__date">
          {(result.date as string) || ''}
        </div>
        <div className="tool-card__timezone">
          {(result.timezone as string) || ''}
        </div>
      </div>
    </div>
  );
}

function DeviceCard({ result }: { result: Record<string, unknown> }) {
  const isOn = result.status === 'on' || result.status === true;
  const properties = (result.properties as Record<string, unknown>) || {};

  return (
    <div className="tool-card__body">
      <div className="tool-card--device">
        <div className="tool-card__device-name">
          <span
            className={`tool-card__status-dot ${
              isOn ? 'tool-card__status-dot--on' : 'tool-card__status-dot--off'
            }`}
          />
          {(result.name as string) || (result.device as string) || 'Device'}
        </div>
        <div className="tool-card__props">
          {Object.entries(properties).map(([key, value]) => (
            <span key={key}>
              {key}: {String(value)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function SystemCard({ result }: { result: Record<string, unknown> }) {
  const metrics = (result.metrics as Record<string, unknown>) || result;

  function getValueClass(value: unknown): string {
    const num = typeof value === 'number' ? value : parseFloat(String(value));
    if (isNaN(num)) return '';
    if (num >= 90) return 'tool-card__metric-value--error';
    if (num >= 70) return 'tool-card__metric-value--warning';
    return 'tool-card__metric-value--ok';
  }

  return (
    <div className="tool-card__body">
      <div className="tool-card--system">
        <div className="tool-card__metrics">
          {Object.entries(metrics)
            .filter(([key]) => key !== 'metrics')
            .map(([key, value]) => (
              <div key={key} className="tool-card__metric">
                <span className="tool-card__metric-label">{key}</span>
                <span
                  className={`tool-card__metric-value ${getValueClass(value)}`}
                >
                  {String(value)}
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function ReminderCard({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="tool-card__body">
      <div className="tool-card--reminder">
        <div className="tool-card__reminder-text">
          {(result.message as string) || (result.text as string) || ''}
        </div>
        {result.countdown != null && (
          <div className="tool-card__countdown">
            {String(result.countdown)}
          </div>
        )}
        {result.time != null && (
          <div className="tool-card__countdown">
            {String(result.time)}
          </div>
        )}
      </div>
    </div>
  );
}

function NewsCard({ result }: { result: Record<string, unknown> }) {
  const headlines = (result.headlines as Array<Record<string, unknown>>) || [];

  return (
    <div className="tool-card__body">
      <div className="tool-card--news">
        {headlines.map((item, i) => (
          <div key={i} className="tool-card__headline">
            {item.source ? (
              <span className="tool-card__source">
                [{String(item.source)}]
              </span>
            ) : null}
            {String(item.title || item.headline || '')}
          </div>
        ))}
      </div>
    </div>
  );
}

function CalculationCard({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="tool-card__body">
      <div className="tool-card--calculation">
        <div className="tool-card__expression">
          {(result.expression as string) || ''}
        </div>
        <div className="tool-card__result">
          = {String(result.result ?? result.answer ?? '')}
        </div>
      </div>
    </div>
  );
}

function TextCard({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="tool-card__body">
      <div className="tool-card--text">
        <div className="tool-card__text-content">
          {(result.text as string) ||
            (result.content as string) ||
            JSON.stringify(result, null, 2)}
        </div>
      </div>
    </div>
  );
}

const CARD_RENDERERS: Record<
  string,
  (props: { result: Record<string, unknown> }) => JSX.Element
> = {
  weather: WeatherCard,
  time: TimeCard,
  device: DeviceCard,
  system: SystemCard,
  reminder: ReminderCard,
  news: NewsCard,
  calculation: CalculationCard,
  text: TextCard,
};

export function ToolResultCard({ result }: ToolResultCardProps) {
  const Renderer = CARD_RENDERERS[result.displayType] || TextCard;

  return (
    <div className={`tool-card tool-card--${result.displayType}`}>
      <div className="tool-card__header">{result.name}</div>
      <Renderer result={result.result} />
    </div>
  );
}
