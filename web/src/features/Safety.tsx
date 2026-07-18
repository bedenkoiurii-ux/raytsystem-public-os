import { Ban, Check, CircleDot, Fingerprint, KeyRound, LockKeyhole, Network, Radar, ShieldCheck, WifiOff } from "lucide-react";
import { useCatalog, useSystem } from "../hooks";
import { usePlatformFeatures } from "../featureHooks";
import { catalogDescription, isolationLabel, localizedCatalogLabel } from "../presentation";
import { ErrorState, LoadingState, StatusPill } from "../components/StatePanel";

export function Safety() {
  const system = useSystem();
  const catalog = useCatalog();
  const platform = usePlatformFeatures();
  if (system.isLoading || catalog.isLoading) return <LoadingState label="Перевіряємо межу безпеки…" />;
  if (system.isError || catalog.isError || !system.data || !catalog.data) return <ErrorState error={system.error ?? catalog.error} />;
  return (
    <div className="route safety-route">
      <section className="safety-hero panel">
        <div className="safety-seal"><ShieldCheck size={34} /><span /></div>
        <div><span className="eyebrow">Межа довіри · активна</span><h2>Локальність закладена в архітектуру.</h2><p>Браузер може змінювати окремий журнал задач і перебудовувану проекцію графа коду. Він не може запускати агентів, виконувати shell-команди або змінювати канонічні знання.</p></div>
        <StatusPill status="verified" label="межа перевірена" />
      </section>
      <div className="safety-grid">
        <section className="panel safety-card"><Network size={20} /><span className="eyebrow">Мережа</span><h3>Тільки loopback</h3><ul><li><Check />Прив'язка до 127.0.0.1</li><li><Check />Точний збіг Host + Origin</li><li><WifiOff />Без зовнішніх ресурсів і аналітики</li></ul></section>
        <section className="panel safety-card"><KeyRound size={20} /><span className="eyebrow">Сесія браузера</span><h3>Подвійний захист запису</h3><ul><li><Check />HttpOnly SameSite cookie</li><li><Check />Окремий заголовок CSRF</li><li><Check />Ідемпотентність кожного запису</li></ul></section>
        <section className="panel safety-card"><Fingerprint size={20} /><span className="eyebrow">Стан</span><h3>Прив'язка до покоління</h3><ul><li><Check />SHA-256 знань</li><li><Check />Вказівник покоління задач</li><li><Check />Відбиток каталогу</li></ul></section>
        <section className="panel safety-card"><Ban size={20} /><span className="eyebrow">Недоступно за задумом</span><h3>Без прихованого виконання</h3><ul><li><LockKeyhole />Немає endpoint командної оболонки</li><li><LockKeyhole />Немає публікації через веб</li><li><LockKeyhole />Немає зовнішніх змін</li></ul></section>
      </div>
      <section className="adapter-matrix panel">
        <header className="panel-header"><div><span className="eyebrow">Адаптери середовища виконання</span><h3>Контракти без прихованих можливостей</h3></div><Radar size={21} /></header>
        {catalog.data.adapters.map((adapter) => (
          <div className="adapter-row" key={adapter.adapter_id}>
            <span className="adapter-mark"><CircleDot size={16} /></span>
            <span><strong>{localizedCatalogLabel(adapter.adapter_id, adapter.name)}</strong><small>{isolationLabel(adapter.isolation_mode)}</small></span>
            <StatusPill status={adapter.state} />
            <p>{catalogDescription(adapter.adapter_id, adapter.reason ?? "Причину не вказано.")}</p>
          </div>
        ))}
      </section>
      <section className="policy-boundary panel">
        <div><span className="eyebrow">Межа підтвердження</span><h3>Усі незворотні дії залишаються поза межами цієї версії.</h3></div>
        <div className="policy-flow"><span>намір у браузері</span><i /> <span>типізована перевірка</span><i /> <span>задачі / derived-граф</span><i className="stopped" /> <span className="denied">канонічна або зовнішня дія</span></div>
      </section>
      <section className="safety-monitor panel">
        <header className="panel-header"><div><span className="eyebrow">Self-monitoring</span><h3>Операційний контур чесно звітує про себе</h3></div>{platform.data ? <StatusPill status={platform.data.state} /> : null}</header>
        {platform.isLoading ? <LoadingState label="Читаємо операційний стан…" /> : null}
        {platform.isError ? <ErrorState error={platform.error} onRetry={() => void platform.refetch()} /> : null}
        {platform.data ? (
          <div className="safety-monitor-grid">
            <div><strong>{Object.values(platform.data.active_feature_flags ?? {}).filter(Boolean).length}</strong><small>active feature flags</small></div>
            <div><strong>{platform.data.event_backlog ?? 0}</strong><small>append-only audit events</small></div>
            <div><strong>{platform.data.notification_backlog ?? 0}</strong><small>notification backlog</small></div>
            <div><strong>{platform.data.outbox_backlog ?? 0}</strong><small>external outbox drafts</small></div>
            <div><strong>{platform.data.eval_regression_count ?? 0}</strong><small>eval regressions</small></div>
            <div><strong>{platform.data.circuit_breakers?.length ?? 0}</strong><small>open circuit breakers</small></div>
            <div><strong>{platform.data.mcp_health ?? "unavailable"}</strong><small>MCP health</small></div>
            <div><strong>{platform.data.a2a_state ?? "disabled"}</strong><small>A2A exposure: {platform.data.a2a_network_exposure ? "network" : "none"}</small></div>
            <div><strong>{platform.data.encryption_provider?.state ?? "unavailable"}</strong><small>encryption provider</small></div>
            <div><strong>{platform.data.last_successful_backup ? "recorded" : "none"}</strong><small>last successful backup</small></div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
