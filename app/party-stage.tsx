"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { players } from "../lib/party/players";
import "./stage.css";

type Player = (typeof players)[number];

interface PartyStageProps {
  onJoin: () => void;
  registeredCount: number;
  myName: string | null;
}

export function Avatar({ player, className = "" }: { player: Player; className?: string }) {
  const { photo, size, x, y } = player;
  return (
    <span className={`bp-avatar ${className}`}>
      <img
        src={photo}
        alt=""
        draggable={false}
        style={{
          width: `${1206 / size * 100}%`,
          top: `${-y / size * 100}%`,
          left: `${-x / size * 100}%`,
        }}
      />
    </span>
  );
}

function SymbolIcon({ name, size = 20 }: { name: "gift" | "pause" | "play" | "left" | "right" | "camera"; size?: number }) {
  const shapes = {
    gift: <><path d="M3 9h18v4H3zM5 13v8h14v-8M12 9v12"/><path d="M12 9C9 9 5.6 8.4 5.6 5.8a2.5 2.5 0 0 1 4.7-1c.8 1.4 1.3 2.8 1.7 4.2Zm0 0c3 0 6.4-.6 6.4-3.2a2.5 2.5 0 0 0-4.7-1C12.9 6.2 12.4 7.6 12 9Z"/></>,
    pause: <><path d="M8.5 6v12m7-12v12" strokeWidth="3"/></>,
    play: <path d="m9 5 9 7-9 7Z" fill="currentColor" stroke="none"/>,
    left: <path d="m14.5 5.5-6 6.5 6 6.5"/>,
    right: <path d="m9.5 5.5 6 6.5-6 6.5"/>,
    camera: <><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.7" r=".9" fill="currentColor" stroke="none"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function Star({ className = "" }: { className?: string }) {
  return <span className={`bp-star ${className}`} aria-hidden="true" />;
}

function ProfileCard({ player, index, direction }: { player: Player; index: number; direction: number }) {
  return (
    <article className="bp-profile" style={{ "--card-shade": player.shade } as CSSProperties} data-direction={direction < 0 ? "back" : "next"} aria-label={`Player ${index + 1} of ${players.length}: ${player.name}`}>
      <div className="bp-card-art">
        <div className="bp-art-inset" aria-hidden="true" />
        <span className="bp-card-edition" aria-hidden="true">BP<span>✳</span></span>
        <span className="bp-card-year" aria-hidden="true">’26</span>
        <Star className="bp-art-star bp-as1" /><Star className="bp-art-star bp-as2" />
        <Star className="bp-art-star bp-as3" /><Star className="bp-art-star bp-as4" />
        <div className="bp-ornament">
          <div className="bp-orn-thread" aria-hidden="true" />
          <span className="bp-orn-loop" aria-hidden="true" />
          <span className="bp-orn-cap" aria-hidden="true" />
          <div className="bp-orn-photo"><Avatar player={player} /></div>
        </div>
      </div>
      <div className="bp-card-copy">
        <p className="bp-handle">{player.handle ? <><SymbolIcon name="camera" size={14} /> @{player.handle.replace(/^@/, "")}</> : <><SymbolIcon name="camera" size={14} /> BLOCK PARTY</>}</p>
        <h2>{player.name}</h2>
        <p className="bp-bio">{player.bio}</p>
      </div>
    </article>
  );
}

export default function PartyStage({ onJoin, registeredCount, myName }: PartyStageProps) {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [deckVisible, setDeckVisible] = useState(true);
  const deckRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const activePlayer = players[current];

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setMotion = () => setPlaying(!motion.matches);
    const visibility = () => setPageVisible(!document.hidden);
    const deck = deckRef.current;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      ([entry]) => setDeckVisible(entry.isIntersecting),
      { threshold: 0.12 },
    );
    setMotion();
    visibility();
    if (deck) observer?.observe(deck);
    motion.addEventListener("change", setMotion);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer?.disconnect();
      motion.removeEventListener("change", setMotion);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    if (!playing || !pageVisible || hovered || !deckVisible) return;
    const timer = window.setTimeout(() => {
      setDirection(1);
      setCurrent((current + 1) % players.length);
    }, 4900 + Math.max(0, activePlayer.bio.length - 65) * 22);
    return () => window.clearTimeout(timer);
  }, [activePlayer.bio.length, current, deckVisible, hovered, pageVisible, playing]);

  function select(index: number, step = 1) {
    setDirection(step);
    setPlaying(false);
    setCurrent((index + players.length) % players.length);
  }

  function selectFromRoster(index: number) {
    select(index, index < current ? -1 : 1);
    if (window.matchMedia("(max-width: 720px)").matches) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      deckRef.current?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center" });
    }
  }

  return (
    <div className="bp-stage">
      <header className="bp-header">
        <div className="bp-wrap bp-header-inner">
          <a className="bp-brand" href="#party-home" aria-label="Block Party home">
            <span className="bp-mark"><SymbolIcon name="gift" size={25}/></span>
            <span>BLOCK PARTY<span className="bp-brand-dot">.</span></span>
          </a>
          <nav className="bp-nav" aria-label="Main navigation">
            <a href="#party-lineup">The lineup</a>
          </nav>
        </div>
      </header>

      <main id="party-home">
        <section className="bp-intro" aria-label="Block Party Secret Santa">
          <div className="bp-wrap bp-hero">
            <div className="bp-hero-copy">
              <p className="bp-edition"><span aria-hidden="true" /> RICHMOND, VA <i> / </i> HOLIDAY EXCHANGE ’26</p>
              <h1 className="bp-title">Secret<span>Santa<span className="bp-title-dot">.</span></span></h1>
              <div className="bp-join-row">
                <button type="button" className="bp-join" onClick={onJoin}><SymbolIcon name="gift" size={21} />{myName ? "My draw" : "Pick my name"}</button>
                <span className="bp-checkin"><span className="bp-progress"><span style={{ width: `${Math.min(players.length, Math.max(0, registeredCount)) / players.length * 100}%` }} /></span>{registeredCount} of {players.length} checked in</span>
              </div>
            </div>

            <div
              className="bp-reel"
              ref={deckRef}
              role="region"
              aria-roledescription="carousel"
              aria-label="Meet the players"
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  select(current - 1, -1);
                }
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  select(current + 1);
                }
              }}
            >
              <div
                className="bp-stack"
                onTouchStart={(event) => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }}
                onTouchCancel={() => { touch.current = null; }}
                onTouchEnd={(event) => {
                  if (!touch.current) return;
                  const dx = event.changedTouches[0].clientX - touch.current.x;
                  const dy = event.changedTouches[0].clientY - touch.current.y;
                  touch.current = null;
                  if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.4) {
                    const step = dx < 0 ? 1 : -1;
                    select(current + step, step);
                  }
                }}
              >
                <div className="bp-back-card bp-back-one" aria-hidden="true" />
                <div className="bp-back-card bp-back-two" aria-hidden="true" />
                <div className="bp-front-card" aria-live={playing ? "off" : "polite"} aria-atomic="true">
                  <ProfileCard key={activePlayer.id} player={activePlayer} index={current} direction={direction} />
                </div>
              </div>
              <div className="bp-reel-controls">
                <span className="bp-position"><b>{String(current + 1).padStart(2, "0")}</b><span> / </span>{String(players.length).padStart(2, "0")}</span>
                <div className="bp-reel-buttons">
                  <button type="button" onClick={() => select(current - 1, -1)} aria-label="Previous player"><SymbolIcon name="left" size={16}/></button>
                  <button type="button" onClick={() => { setPlaying(p => !p); setHovered(false); }} aria-label={playing ? "Pause rolling lineup" : "Play rolling lineup"}><SymbolIcon name={playing ? "pause" : "play"} size={15}/></button>
                  <button type="button" onClick={() => select(current + 1)} aria-label="Next player"><SymbolIcon name="right" size={16}/></button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="party-lineup" className="bp-lineup" aria-labelledby="party-lineup-title">
          <div className="bp-wrap">
            <div className="bp-lineup-heading"><h2 id="party-lineup-title">The lineup<span>.</span></h2><div className="bp-lineup-rule" aria-hidden="true"/><p>{players.length} players</p></div>
            <div className="bp-roster">
              {players.map((player, index) => <button
                key={player.id}
                type="button"
                className={`bp-lineup-person${index === current ? " is-active" : ""}`}
                aria-label={`View ${player.name}'s profile`}
                aria-pressed={index === current}
                onClick={() => selectFromRoster(index)}
              >
                <span className="bp-thumb-ring"><Avatar player={player} /></span>
                <span>{player.first}</span>
              </button>)}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
