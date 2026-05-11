// TODO: subscribe to alarm stream and display active alarms with ACK button.
import { useTranslation } from "react-i18next";

export function AlarmBanner() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        height: 32,
        background: "#1e293b",
        color: "#94a3b8",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        fontSize: 13,
        borderBottom: "1px solid #334155",
      }}
    >
      {t("alarm.noAlarms")}
    </div>
  );
}
