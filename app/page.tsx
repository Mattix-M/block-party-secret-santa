"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Gift, RotateCcw, X } from "lucide-react";
import PartyStage, { Avatar } from "./party-stage";
import { getPlayer, players } from "../lib/party/players";
import { giftIdeasLimit, type ExchangeView, type GiftPreference } from "../lib/party/game";
import "./sheets.css";

type PartyView = ExchangeView & { recoveryPath?: string | null; groupInvitePath?: string; hostResult?: { ids: string[]; count: number } | null };
type Screen = "account" | "veto" | "gift" | "edit-veto" | "edit-gift";
const count = players.length;
const noPreference: GiftPreference = { style: "either", ideas: "" };
const giftLabels: Record<GiftPreference["style"], string> = {
  funny: "A fuckass gift", serious: "A serious gift", either: "Either works",
};
const giftStyles = Object.keys(giftLabels) as GiftPreference["style"][];

function GiftRequest({ title, preference, onEdit }: {
  title: string;
  preference?: GiftPreference | null;
  onEdit?: () => void;
}) {
  const gift = preference ?? noPreference;
  return <section className={onEdit ? "gift-request own-request" : "gift-request"} aria-label={title}>
    <div className="gift-request-top"><h3>{title}</h3>
      {onEdit && <button type="button" className="sheet-link" onClick={onEdit}>Edit my gift ideas</button>}
    </div>
    <strong>{giftLabels[gift.style]}</strong>
    {gift.ideas && <p>{gift.ideas}</p>}
  </section>;
}

export default function Home() {
  const [view, setView] = useState<PartyView | null>(null);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [identity, setIdentity] = useState<string | null>(null);
  const [veto, setVeto] = useState<string | null>(null);
  const [gift, setGift] = useState<GiftPreference>(noPreference);
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
      el.querySelector<HTMLElement>("#sheet-title")?.focus({ preventScroll: true });
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

  async function save(action: Record<string, unknown>) {
    const result = await act(action);
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
  function go(next: Screen) { setScreen(next); setError(""); }
  function chooseName(id: string) {
    if (id !== identity) { setVeto(null); setGift(noPreference); }
    setIdentity(id);
    go("veto");
  }
  function editGift() {
    if (!me) return;
    setIdentity(me.id);
    setGift(view?.myGiftPreference ?? noPreference);
    go("edit-gift");
  }

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
          <h2 id="sheet-title" tabIndex={-1}>The exchange</h2>
          {!error && <p>Getting the guest list…</p>}
        </> : (screen === "veto" || screen === "edit-veto") && chosen ? <>
          <div className="sheet-kicker">ONE VETO · {chosen.first.toUpperCase()}</div>
          <h2 id="sheet-title" tabIndex={-1}>Anyone but this motherfucker.</h2>
          <p>1 veto, its annonymous chilllll</p>
          <fieldset className="veto-list"><legend className="sr-only">Who do you veto?</legend>
            <label className={'no-veto '+ (veto === null ? 'selected' : '')}><input type="radio" name="veto" checked={veto === null} onChange={() => setVeto(null)}/>
              <span>Fuck it, I’ll take anyone.</span><i>{veto === null && <Check size={12}/>}</i></label>
            <div className="veto-grid">{players.filter(p => p.id !== identity).map(p =>
              <label key={p.id} className={veto === p.id ? 'selected' : ''}><input type="radio" name="veto" checked={veto === p.id} onChange={() => setVeto(p.id)}/>
                <Avatar player={p} className="mini-face"/><span>{p.first}</span><i>{veto === p.id && <Check size={12}/>}</i></label>)}</div></fieldset>
          {screen === "edit-veto"
            ? <button type="button" className="sheet-main" disabled={busy} onClick={() => save({ type: "register", player: identity, veto })}>{busy ? "Saving…" : "Save my veto"}</button>
            : <button type="button" className="sheet-main" onClick={() => go("gift")}>Continue to gift ideas</button>}
          <button className="sheet-link" disabled={busy} onClick={() => go("account")}>{screen === "edit-veto" ? "Back to my draw" : "Back to names"}</button>
        </> : (screen === "gift" || screen === "edit-gift") && chosen ? <>
          <div className="sheet-kicker">FOR MY SANTA · {chosen.first.toUpperCase()}</div>
          <h2 id="sheet-title" tabIndex={-1}>What do you want?</h2>
          <p>Whoever draws you will see this when they open their match.</p>
          <fieldset className="gift-options" disabled={busy}>
            <legend className="sr-only">What kind of gift do you want?</legend>
            {giftStyles.map(style =>
              <label className="gift-choice" key={style}>
                <input type="radio" name="gift-style" value={style} checked={gift.style === style}
                  onChange={() => setGift(current => ({ ...current, style }))} />
                <span>{giftLabels[style]}</span>
              </label>)}
          </fieldset>
          <label className="ideas-label" htmlFor="gift-ideas">Any gift ideas? <span>Optional</span></label>
          <textarea id="gift-ideas" className="ideas-input" rows={3} maxLength={giftIdeasLimit} disabled={busy}
            value={gift.ideas} onChange={e => setGift({ ...gift, ideas: e.target.value })}
            placeholder="Coffee beans, sour candy, a link to that exact hoodie…" aria-describedby="ideas-limit"/>
          <div className="ideas-count" aria-hidden="true">{gift.ideas.length}/{giftIdeasLimit}</div>
          <span className="sr-only" id="ideas-limit">Up to {giftIdeasLimit} characters.</span>
          <button type="button" className="sheet-main" disabled={busy}
            onClick={() => save(screen === "edit-gift"
              ? { type: "gift", giftPreference: gift }
              : { type: "register", player: identity, veto, giftPreference: gift })}>
            {busy ? "Saving…" : screen === "edit-gift" ? "Save my gift ideas" : "Lock me in"}
          </button>
          <button type="button" className="sheet-link" disabled={busy} onClick={() => go(screen === "edit-gift" ? "account" : "veto")}>
            {screen === "edit-gift" ? "Back to my draw" : "Back to my veto"}
          </button>
        </> : !me ? <>
          <div className="sheet-kicker">THE GUEST LIST · {view.claimed.length}/{count} IN</div>
          <h2 id="sheet-title" tabIndex={-1}>Who are you?</h2>
          <p>{view.isHost ? "Your host invite is for Gleb. Pick your name to register." : "Pick your own name. You get one veto before the draw."}</p>
          <div className="claim-grid">{players.map(p => {
            const taken = view.claimed.includes(p.id);
            const reserved = view.isHost ? p.id !== "gleb" : p.id === "gleb";
            return <button key={p.id} type="button" disabled={taken || reserved}
              onClick={() => chooseName(p.id)}>
              <Avatar player={p} className="sheet-photo"/><span><b>{p.first}</b>
              {taken ? <small>Claimed</small> : p.id === "gleb" ? <small>{view.isHost ? "You" : "Host link only"}</small> : null}</span></button>;
          })}</div>
        </> : <>
          <div className="sheet-kicker">PRIVATE DRAW · {me.first.toUpperCase()}</div>
          {spinning ? <><h2 id="sheet-title" tabIndex={-1}>Drawing…</h2><div className="spin-stage" aria-hidden="true"><Avatar player={players[spinIndex]} className="big-face"/><strong>{players[spinIndex].first}</strong></div></> :
           view.drawn && recipient ? <>
            <h2 id="sheet-title" tabIndex={-1}>You got {recipient.first}.</h2>
            <div className="recipient-card"><Avatar player={recipient} className="big-face"/><div><b>{recipient.name}</b>{recipient.handle && <small>@{recipient.handle}</small>}<p>{recipient.bio}</p></div></div>
            <GiftRequest title={recipient.first + "’s gift request"} preference={view.recipientGiftPreference}/>
            <p>Get them a gift. Keep their name out of the group chat.</p>
          </> : view.drawn ? <>
            <span className="sheet-symbol"><Gift size={29}/></span><h2 id="sheet-title" tabIndex={-1}>Your draw is ready.</h2>
            <p>Everyone has a match. Open yours somewhere your roommate can’t read over your shoulder.</p>
            <button className="sheet-main" disabled={busy} onClick={openDraw}>Who am I stuck with?</button>
          </> : <>
            <h2 id="sheet-title" tabIndex={-1}>{view.blocked ? "The vetoes collided." : "You’re in, " + me.first + "."}</h2>
            <p>{view.blocked ? "There’s no draw that honors all ten picks. If you’re willing, change or drop your veto so we can draw again." : "Your match unlocks when all ten people register."}</p>
            <div className="join-progress" aria-label={view.claimed.length+' of '+count+' registered'}><span style={{width:(view.claimed.length/count*100)+'%'}}/></div>
            <div className="sheet-note">{view.claimed.length} of {count} registered</div>
            <div className="my-veto"><span>Your veto</span><strong>{getPlayer(view.myVeto)?.name || "I’ll take anyone."}</strong></div>
            <button className="sheet-secondary" onClick={() => {setIdentity(me.id); setVeto(view.myVeto); go("edit-veto");}}>Edit my veto</button>
          </>}
          {!spinning && <GiftRequest title="For my Santa" preference={view.myGiftPreference} onEdit={editGift}/>}
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
