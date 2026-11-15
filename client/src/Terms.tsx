import { useState, type ReactNode } from 'react';
import { DEV_LOCAL } from './devGate';
import { getConsent, setConsent } from './consent';
import { initTelemetry } from './telemetry';

/**
 * Las condiciones de servicio: pantalla previa al juego. Hay que aceptarlas para jugar; los informes de fallo son aparte y opcionales.
 * Si cambia el texto, sube TERMS_VERSION (consent.ts) y se vuelven a pedir. En desarrollo local no se pide (salvo con ?terms, para verla).
 * OJO: es un texto base; que lo revise quien responda legalmente del juego antes de publicarlo.
 */
export default function Terms({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(() => (DEV_LOCAL && !location.search.includes('terms')) || !!getConsent());
  const [agree, setAgree] = useState(false);
  const [reports, setReports] = useState(false);
  if (ok) return <>{children}</>;
  const go = () => (setConsent(reports), initTelemetry(), setOk(true));
  return (
    <div className="br" data-screen="off">
      <nav className="br-menu br-terms" aria-label="Terms of service">
        <h1 className="br-menu__title">TERMS</h1>
        <p className="br-menu__sub">READ THIS BEFORE YOU ENTER · PLAYING MEANS YOU ACCEPT IT</p>
        <dl>
          <dt>1 · THE GAME</dt>
          <dd>Horror game with flashing lights, loud sounds, jump scares and dark places. If you are photosensitive or easily frightened, think twice. Play at your own risk and take breaks.</dd>
          <dt>2 · ACCOUNT AND CONDUCT</dt>
          <dd>You are responsible for your account and what is done with it. No cheating, no exploiting bugs to harm others, no harassment, no insults, threats or illegal content in voice or chat. We may remove content or suspend accounts that break these rules.</dd>
          <dt>3 · DATA WE KEEP</dt>
          <dd>Account data (name, progress, friends, inventory) is stored on our server; your settings, in your browser. Voice goes live to the players in your room and is not recorded. Chat goes to the room and may be logged to handle abuse. We do not sell your data.</dd>
          <dt>4 · ERROR REPORTS (OPTIONAL)</dt>
          <dd>If you tick the box below, a crash sends an anonymous report: the error, browser and device type, level, map seed and where you were standing. No account name, no chat, no voice. To withdraw, clear this site's data.</dd>
          <dt>5 · NO WARRANTY</dt>
          <dd>Provided as is. It is a work in progress and may lose progress or stop working. Within what the law allows, we are not liable for damages from using it. If these terms change, we will ask again.</dd>
        </dl>
        <ul>
          <li>
            <button type="button" className="br-opt br-check" role="checkbox" aria-checked={reports} onClick={() => setReports(!reports)}>
              [{reports ? 'X' : ' '}] SEND ANONYMOUS ERROR REPORTS (OPTIONAL)
            </button>
          </li>
          <li>
            <button type="button" className="br-opt br-check" role="checkbox" aria-checked={agree} onClick={() => setAgree(!agree)}>
              [{agree ? 'X' : ' '}] I AM OLD ENOUGH TO CONSENT WHERE I LIVE (16+ IN MOST OF EUROPE) AND I ACCEPT THESE TERMS
            </button>
          </li>
          <li>
            <button type="button" className="br-opt" disabled={!agree} onClick={go}>
              ENTER
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
