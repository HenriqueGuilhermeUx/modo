import { getSessionToken } from "./api";

export default function PasswordRecoveryEntry({ mode }: { mode: "business" | "agency" }) {
  if (getSessionToken()) return null;
  return (
    <a
      href={`/esqueci-minha-senha?mode=${mode}`}
      style={{
        position: "fixed",
        right: 22,
        bottom: 20,
        zIndex: 1200,
        border: "1px solid #d8e1ef",
        borderRadius: 999,
        padding: "10px 14px",
        background: "rgba(255,255,255,.96)",
        boxShadow: "0 12px 35px rgba(13,27,62,.12)",
        color: "#1f5eff",
        textDecoration: "none",
        fontSize: 11,
        fontWeight: 900,
      }}
    >
      Esqueci minha senha
    </a>
  );
}
