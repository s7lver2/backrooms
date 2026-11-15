import { useState, type ReactNode } from 'react';
import { DEV_LOCAL } from './devGate';
import { getConsent, setConsent } from './consent';
import { initTelemetry } from './telemetry';

/**
 * Las condiciones de servicio: pantalla previa al juego. Hay que aceptarlas para jugar; los informes de fallo son aparte y opcionales.
 * Si cambia el texto, sube TERMS_VERSION (consent.ts) y se vuelven a pedir. En desarrollo local no se pide.
 * OJO: es un texto base; que lo revise quien responda legalmente del juego antes de publicarlo.
 */
export default function Terms({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(() => DEV_LOCAL || !!getConsent());
  const [agree, setAgree] = useState(false);
  const [reports, setReports] = useState(false);
  if (ok) return <>{children}</>;
  const go = () => (setConsent(reports), initTelemetry(), setOk(true));
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'auto', background: '#0b0a07', color: '#d9d2b4', fontFamily: 'var(--br-font, monospace)', display: 'flex', justifyContent: 'center', padding: '4vh 16px' }}>
      <div style={{ maxWidth: 680, width: '100%', lineHeight: 1.5 }}>
        <h1 style={{ letterSpacing: '0.2em', fontSize: '1.4em', margin: '0 0 0.6em' }}>BACKROOMS · TERMS OF SERVICE</h1>
        <p>Before you enter, please read this. By playing you accept it.</p>
        <h2 style={{ fontSize: '1em', letterSpacing: '0.12em' }}>1. THE GAME</h2>
        <p>Backrooms is a horror game with flashing lights, loud sounds, jump scares and dark places. If you are photosensitive or easily frightened, think twice. Play at your own risk and take breaks.</p>
        <h2 style={{ fontSize: '1em', letterSpacing: '0.12em' }}>2. YOUR ACCOUNT AND CONDUCT</h2>
        <p>You are responsible for your account and everything done with it. Do not cheat, exploit bugs to harm others, harass other players or use voice and chat to insult, threaten or share illegal content. We may remove content or suspend accounts that break these rules.</p>
        <h2 style={{ fontSize: '1em', letterSpacing: '0.12em' }}>3. DATA WE KEEP</h2>
        <p>
          To run the game we store your account data (name, progress, friends, inventory) on our server, and your settings in your browser (local storage). Voice chat is sent live to the players in your room and is not recorded. Chat messages are delivered to the room and may be logged to
          handle abuse. We do not sell your data.
        </p>
        <h2 style={{ fontSize: '1em', letterSpacing: '0.12em' }}>4. ERROR REPORTS (OPTIONAL)</h2>
        <p>If you tick the box below, when the game crashes it sends an anonymous report to our error tracker: the error, your browser and device type, the level, the map seed and where you were standing. No account name, no IP address kept for profiling, no chat or voice. You can change your mind by clearing this site’s data.</p>
        <h2 style={{ fontSize: '1em', letterSpacing: '0.12em' }}>5. NO WARRANTY</h2>
        <p>The game is provided “as is”, it is a work in progress and may lose progress or stop working. To the extent the law allows, we are not liable for damages from using it. These terms may change; if they do we will ask you again.</p>
        <label style={{ display: 'flex', gap: 10, margin: '1.2em 0 0.6em', cursor: 'pointer' }}>
          <input type="checkbox" checked={reports} onChange={(e) => setReports(e.target.checked)} />
          <span>Send anonymous error reports (optional)</span>
        </label>
        <label style={{ display: 'flex', gap: 10, margin: '0.6em 0 1.2em', cursor: 'pointer' }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I am old enough to consent where I live (16+ in most of Europe), and I accept these terms</span>
        </label>
        <button disabled={!agree} onClick={go} style={{ font: 'inherit', letterSpacing: '0.2em', padding: '0.7em 1.6em', background: agree ? '#d9d2b4' : '#3a3628', color: '#0b0a07', border: 0, cursor: agree ? 'pointer' : 'not-allowed' }}>
          ENTER
        </button>
      </div>
    </div>
  );
}
