"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Gift, RotateCcw, X } from "lucide-react";
import PartyStage, { Avatar } from "./party-stage";
import { getPlayer, players } from "../lib/party/players";
import type { ExchangeView } from "../lib/party/game";
import "./sheets.css";

type PartyView = ExchangeView & { recoveryPath?: string | null; groupInvitePath?: string; hostResult?: { ids: string[]; count: number } | null };
type Screen = "account" | "veto";
const count = players.length;

export default function Home() {
  const [view, setView] = useState<PartyView | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [veto, setVeto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [spinIndex, setSpinIndex] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState("");
  const version = useRef(0);
  const posting = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    if (posting.current) return;
    const current = ++version.current;
    try {
      const res = await fetch("/api/exchange", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn’t load the exchange.");
      if (current === version.current) setView(data);
    } catch (err) {
      if (current === version.current) setError(err instanceof Error ? err.message : "Couldn’t load the exchange.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = window.setInterval(onVisible, 15000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [refresh]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (screen && !el.open) el.showModal();
    if (!screen && el.open) el.close();
    if (screen) {
      setCopied(null); setManualCopy("");
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      el.scrollTop = 0;
      return () => { document.body.style.overflow = previous; };
    }
  }, [screen]);

  useEffect(() => {
    if (!spinning) return;
    const interval = window.setInterval(() => setSpinIndex((i) => (i + 1) % count), 105);
    return () => window.clearInterval(interval);
  }, [spinning]);

  function show(next: Screen) {
    setScreen(next); setError(""); setCopied(null); setManualCopy("");
    void refresh();
  }

  async function act(action: Record<string, unknown>): Promise<PartyView | null> {
    if (posting.current) return null;
    posting.current = true;
    ++version.current;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/exchange", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That didn’t save. Try again.");
      setView(data);
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn’t save. Try again.");
      return null;
    } finally {
      posting.current = false; setBusy(false);
    }
  }

  async function register() {
    if (!identity) return;
    const result = await act({ type: "register", player: identity, veto });
    if (result) setScreen("account");
    else void refresh();
  }

  async function openDraw() {
    if (busy || spinning) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSpinning(!reduced);
    const result = await act({ type: "open" });
    if (result && !reduced) await new Promise((resolve) => window.setTimeout(resolve, 1050));
    setSpinning(false);
  }

  async function copyLink(path?: string | null) {
    if (!path) return;
    const href = new URL(path, window.location.origin).href;
    try { await navigator.clipboard.writeText(href); setCopied(path); setManualCopy(""); }
    catch { setManualCopy(href); }
  }

  const me = getPlayer(view?.mine ?? null);
  const chosen = getPlayer(identity);
  const recipient = getPlayer(view?.recipient ?? null);
  const tally = view?.hostResult;
  const close = () => { if (!busy) setScreen(null); };
  const nameStep = () => { setIdentity(null); setScreen("account"); setError(""); };

  return <>
    <PartyStage onJoin={() => show("account")}
      registeredCount={view?.claimed.length ?? 0} myName={me?.first ?? null}/>
    <dialog ref={dialog} className="party-dialog" aria-labelledby="sheet-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dialog.current) { const r=dialog.current.getBoundingClientRect(); if (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom) close(); } }}>
      <div className="sheet-inner">
        <div className="sheet-top"><span><Gift size={16} aria-hidden="true"/> BLOCK PARTY</span>
          <button type="button" className="sheet-x" aria-label="Close" onClick={close}><X size={20}/></button></div>
        {!view ? <>
          <h2 id="sheet-title">The exchange</h2>
          {!error && <p>Getting the guest list…</p>}
        </> : screen === "veto" && chosen ? <>
          <div className="sheet-kicker">ONE VETO · {chosen.first.toUpperCase()}</div>
          <h2 id="sheet-title">Anyone but this motherfucker.</h2>
          <p>1 veto, its annonymous chilllll</p>
          <fieldset className="veto-list"><legend className="sr-only">Who do you veto?</legend>
            <label className={'no-veto '+ (veto === null ? 'selected' : '')}><input type="radio" name="veto" checked={veto === null} onChange={() => setVeto(null)}/>
              <span>Fuck it, I’ll take anyone.</span><i>{veto === null && <Check size={12}/>}</i></label>
            <div className="veto-grid">{players.filter(p => p.id !== identity).map(p =>
              <label key={p.id} className={veto === p.id ? 'selected' : ''}><input type="radio" name="veto" checked={veto === p.id} onChange={() => setVeto(p.id)}/>
                <Avatar player={p} className="mini-face"/><span>{p.first}</span><i>{veto === p.id && <Check size={12}/>}</i></label>)}</div></fieldset>
          <button type="button" className="sheet-main" disabled={busy} onClick={register}>{busy ? "Saving…" : me ? "Save my veto" : "Lock me in"}</button>
          <button className="sheet-link" disabled={busy} onClick={nameStep}>{me ? "Back to my draw" : "Back to names"}</button>
        </> : !me ? <>
          <div className="sheet-kicker">THE GUEST LIST · {view.claimed.length}/{count} IN</div>
          <h2 id="sheet-title">Who are you?</h2>
          <p>{view.isHost ? "Your host invite is for Gleb. Pick your name to register." : "Pick your own name. You get one veto before the draw."}</p>
          <div className="claim-grid">{players.map(p => {
            const taken = view.claimed.includes(p.id);
            const reserved = view.isHost ? p.id !== "gleb" : p.id === "gleb";
            return <button key={p.id} type="button" disabled={taken || reserved}
              onClick={() => {setIdentity(p.id); setVeto(null); setScreen("veto"); setError("");}}>
              <Avatar player={p} className="sheet-photo"/><span><b>{p.first}</b>
              {taken ? <small>Claimed</small> : p.id === "gleb" ? <small>Host</small> : null}</span></button>;
          })}</div>
        </> : <>
          <div className="sheet-kicker">PRIVATE DRAW · {me.first.toUpperCase()}</div>
          {spinning ? <><h2 id="sheet-title">Drawing…</h2><div className="spin-stage" aria-hidden="true"><Avatar player={players[spinIndex]} className="big-face"/><strong>{players[spinIndex].first}</strong></div></> :
           view.drawn && recipient ? <>
            <h2 id="sheet-title">You got {recipient.first}.</h2>
            <div className="recipient-card"><Avatar player={recipient} className="big-face"/><div><b>{recipient.name}</b>{recipient.handle && <small>@{recipient.handle}</small>}<p>{recipient.bio}</p></div></div>
            <p>Get them a gift. Keep their name out of the group chat.</p>
          </> : view.drawn ? <>
            <span className="sheet-symbol"><Gift size={29}/></span><h2 id="sheet-title">Your draw is ready.</h2>
            <p>Everyone has a match. Open yours somewhere your roommate can’t read over your shoulder.</p>
            <button className="sheet-main" disabled={busy} onClick={openDraw}>Who am I stuck with?</button>
          </> : <>
            <h2 id="sheet-title">{view.blocked ? "The vetoes collided." : "You’re in, " + me.first + "."}</h2>
            <p>{view.blocked ? "There’s no draw that honors all ten picks. If you’re willing, change or drop your veto so we can draw again." : "Your match unlocks when all ten people register."}</p>
            <div className="join-progress" aria-label={view.claimed.length+' of '+count+' registered'}><span style={{width:(view.claimed.length/count*100)+'%'}}/></div>
            <div className="sheet-note">{view.claimed.length} of {count} registered</div>
            <div className="my-veto"><span>Your veto</span><strong>{getPlayer(view.myVeto)?.name || "I’ll take anyone."}</strong></div>
            <button className="sheet-secondary" onClick={() => {setIdentity(me.id); setVeto(view.myVeto); setScreen("veto");}}>Edit my veto</button>
          </>}
          {view.recoveryPath && !spinning && <div className="recovery">
            <button className="sheet-link" onClick={() => copyLink(view.recoveryPath)}>{copied === view.recoveryPath ? <Check size={16}/> : <Copy size={16}/>} {copied === view.recoveryPath ? "Private link copied" : "Copy my private return link"}</button>
            <small>Save this for another phone. Anyone with it can open your draw.</small>
            </div>}
        </>}
        {screen === "account" && view?.isHost && <aside className="host-brief">
          {tally && <div className="host-tally"><div className="sheet-kicker">JUST FOR GLEB</div>
            <strong>{tally.count ? "Most vetoed: " + tally.ids.map(id => getPlayer(id)?.first).join(" & ") : "Nobody used a veto."}</strong>
            {tally.count > 0 && <p>{tally.count} {tally.count === 1 ? "veto" : "vetoes"}{tally.ids.length > 1 ? " each" : ""}.</p>}</div>}
          {view.groupInvitePath && <div className="recovery">
            <button className="sheet-link" onClick={() => copyLink(view.groupInvitePath)}>{copied === view.groupInvitePath ? <Check size={16}/> : <Copy size={16}/>} {copied === view.groupInvitePath ? "Group invite copied" : "Copy group chat invite"}</button>
            <small>This is the link to send to BLOCK PARTY.</small></div>}
        </aside>}
        {manualCopy && <input className="manual-copy" aria-label="Link to copy" readOnly value={manualCopy} onFocus={e => e.target.select()}/>}
        {error && <div role="alert" className="sheet-error"><span>{error}</span><button onClick={() => { setError(""); void refresh(); }}><RotateCcw size={15}/> Refresh</button></div>}
      </div>
    </dialog>
  </>;
}
