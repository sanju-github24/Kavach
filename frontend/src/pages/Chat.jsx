import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { createReportDoc, finalizeDoc, sectionHeading, markdownParagraph, brandedTable, PDF_LAYOUT } from '../utils/pdfKit.js';
import { buildReportHtml, serverPdf } from '../utils/reportHtml.js';
import { IconMic, IconEdit, IconCopy, IconCheck, IconSpeaker, IconSpeakerOff, IconPlus, IconTrash, IconMessage, IconDots, IconAlert, IconBolt, IconArrowUpRight, IconSparkle, IconDownload } from '../components/ui/Icons';
import InlineStatChart from '../components/ui/InlineStatChart';
import InlineNetworkGraph from '../components/ui/InlineNetworkGraph';
import InlineTable from '../components/ui/InlineTable';
import ZiaTextPanel from '../components/ui/ZiaTextPanel';
import { listChatSessions, getChatSessionMessages, deleteChatSession } from '../api.js';

// Which intents get an inline visual confirmation alongside the text, and
// which kind — a quick stat bar chart for numbers-heavy answers, or a small
// relationship graph when the answer is about connections between people.
const STAT_INTENTS    = new Set(['pattern_analysis', 'repeat_offenders', 'forecast', 'mo_analysis', 'accused_comparison', 'district_comparison']);
const NETWORK_INTENTS = new Set(['network_analysis', 'fir_accused_link', 'offender_profile']);

const STORAGE_KEY     = 'kavach_chat_history_v1';
const SESSION_ID_KEY   = 'kavach_chat_session_id';
const AUTOSPEAK_KEY    = 'kavach_auto_speak';
// Chat transcript + open-session id are cached PER USER so two accounts on the
// same device never see each other's conversation.
const chatKey = (uid) => `${STORAGE_KEY}_${uid || 'anon'}`;
const sessKey = (uid) => `${SESSION_ID_KEY}_${uid || 'anon'}`;

function relativeTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short' });
}

// Voice output — strips markdown/bullets/bracket directives so the speech
// synthesizer reads clean sentences, not formatting characters.
function ttsCleanText(text) {
  return (text || '')
    .replace(/\[CHART:.*?\]|\[NETWORK:.*?\]|\[MAP:.*?\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/^[•\-*]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUGGESTIONS = [
  'Show all robbery cases in Bengaluru Urban',
  'List repeat offenders with the highest risk score',
  'Which districts have the most open cases?',
  'Who are the accused not yet arrested?',
  'Show the financial network — flagged accounts and money trail',
  'Predict high-risk areas for the next 72 hours',
  'Crime trend analysis across all districts',
  'Bengaluru alli eshtu kesu ide?',
  'ಕರ್ನಾಟಕದಲ್ಲಿ ಅಪರಾಧ ಪ್ರಕರಣಗಳ ವಿಶ್ಲೇಷಣೆ',
];

const COLOR_MAP = {
  red:   { bg: 'bg-risk-critical/15', border: 'border-risk-critical/40', text: 'text-risk-critical', dot: 'bg-risk-critical' },
  amber: { bg: 'bg-risk-high/15',     border: 'border-risk-high/40',     text: 'text-risk-high',     dot: 'bg-risk-high'     },
  green: { bg: 'bg-risk-low/15',      border: 'border-risk-low/40',      text: 'text-risk-low',      dot: 'bg-risk-low'      },
  blue:  { bg: 'bg-[#60A5FA]/15',     border: 'border-[#60A5FA]/40',     text: 'text-[#60A5FA]',     dot: 'bg-[#60A5FA]'     },
  cyan:  { bg: 'bg-accent/15',        border: 'border-accent/40',        text: 'text-accent',        dot: 'bg-accent'        },
};

const INTENT_BADGE = {
  fir_lookup:       { label: 'Case Lookup',        color: 'text-[#60A5FA] bg-[#60A5FA]/10 border-[#60A5FA]/30' },
  fir_accused_link: { label: 'Case–Accused Link',  color: 'text-[#A78BFA] bg-[#A78BFA]/10 border-[#A78BFA]/30' },
  offender_profile: { label: 'Offender Profile',   color: 'text-risk-critical bg-risk-critical/10 border-risk-critical/30' },
  accused_comparison: { label: 'Accused Comparison', color: 'text-risk-critical bg-risk-critical/10 border-risk-critical/30' },
  district_comparison: { label: 'District Comparison', color: 'text-[#60A5FA] bg-[#60A5FA]/10 border-[#60A5FA]/30' },
  repeat_offenders: { label: 'Repeat Offenders',   color: 'text-risk-high bg-risk-high/10 border-risk-high/30' },
  pattern_analysis: { label: 'Pattern Analysis',   color: 'text-accent bg-accent/10 border-accent/30' },
  network_analysis: { label: 'Network Analysis',  color: 'text-[#A78BFA] bg-[#A78BFA]/10 border-[#A78BFA]/30' },
  mo_analysis:      { label: 'MO Patterns',        color: 'text-risk-high bg-risk-high/10 border-risk-high/30' },
  forecast:         { label: 'Forecast',           color: 'text-risk-high bg-risk-high/10 border-risk-high/30' },
  victim_lookup:    { label: 'Victim Lookup',      color: 'text-[#ec4899] bg-[#ec4899]/10 border-[#ec4899]/30' },
  audit_query:      { label: 'Audit Trail',        color: 'text-risk-low bg-risk-low/10 border-risk-low/30' },
  user_profile:     { label: 'Officer Directory',  color: 'text-[#60A5FA] bg-[#60A5FA]/10 border-[#60A5FA]/30' },
  general:          { label: 'Intelligence',       color: 'text-ink-dim bg-white/5 border-base-border' },
};

function BotAvatar() {
  return (
    <div className="w-9 h-9 flex-shrink-0 rounded-xl bg-gradient-to-br from-base-raised to-base-border border border-accent/40 flex items-center justify-center">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="3.5" fill="#FFFFFF"/>
        <rect x="7" y="13" width="10" height="6" rx="2" fill="#FFFFFF" opacity="0.8"/>
        <circle cx="10" cy="8" r="1.2" fill="#000000"/>
        <circle cx="14" cy="8" r="1.2" fill="#000000"/>
      </svg>
    </div>
  );
}

function UserAvatar({ name }) {
  return (
    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold bg-gradient-to-br from-accent to-base-border text-base">
      {name?.charAt(0)?.toUpperCase() || 'O'}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2.5 mb-5 animate-fade-up">
      <BotAvatar />
      <div className="flex items-center gap-2 py-2">
        {[0,1,2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-ink-faint"
            style={{ animation: `kbounce 1.2s ${i*0.25}s infinite ease-in-out` }}/>
        ))}
        <span className="text-xs text-ink-faint ml-1">KAVACH is analyzing records…</span>
      </div>
    </div>
  );
}

// Reveals a freshly-generated session title character by character, like it's
// being typed live — only plays once per session (governed by `play`), then
// the caller flips the flag off so reopening the menu shows static text.
function TypewriterTitle({ text, play, onDone, className }) {
  const [shown, setShown] = useState(play ? '' : text);
  useEffect(() => {
    if (!play) { setShown(text); return; }
    let i = 0;
    setShown('');
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); onDone?.(); }
    }, 22);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const done = shown.length >= text.length;
  return (
    <span className={className}>
      {shown}
      {play && !done && <span className="inline-block w-[2px] h-3 bg-accent ml-0.5 -mb-0.5 animate-pulse" />}
    </span>
  );
}

// Chat history lives behind a "⋯" trigger, not a permanent sidebar — clicking
// it drops down a panel with a scale/fade-in transition; clicking again (or
// outside) plays the same transition in reverse before unmounting.
function HistoryMenu({ open, sessions, activeId, onNew, onSelect, onDelete, loading, onTitleTyped }) {
  const [confirmId, setConfirmId] = useState(null);
  return (
      <div
        className={`absolute right-0 top-full mt-2 w-72 rounded-2xl border border-white/12 z-30 isolate origin-top-right transition-all duration-200 ease-out overflow-hidden flex flex-col ${
          open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1 pointer-events-none'
        }`}
        // Elevated card colour — noticeably lighter than the pure-black page
        // (#000) so it reads as a distinct floating panel. A viewport-relative
        // max-height on the PANEL itself (flex column) means the list scrolls
        // inside the rounded card no matter how many sessions there are — it
        // can never spill past the panel's rounded corners.
        style={{ backgroundColor: '#1C1C1E', maxHeight: 'min(65vh, 26rem)', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)' }}
      >
        <div className="p-2 border-b border-base-border flex-shrink-0">
          <button onClick={onNew}
            className="w-full flex items-center justify-center gap-2 bg-accent text-base font-semibold px-3 py-2 rounded-xl text-xs hover:opacity-90 transition">
            <IconPlus className="w-3.5 h-3.5" /> New chat
          </button>
        </div>
        {/* The list fills the remaining panel height and scrolls within it —
            min-h-0 lets the flex child shrink so overflow-y actually engages. */}
        <div className="overflow-y-auto p-2 space-y-1 flex-1 min-h-0">
        {/* Rows only mount while the panel is actually open, so a freshly
            created session's title types itself out each time it's revealed
            instead of finishing silently off-screen. */}
        {open && loading && (
          <p className="text-[10px] text-ink-faint text-center py-4">Loading history…</p>
        )}
        {open && !loading && sessions.length === 0 && (
          <p className="text-[10px] text-ink-faint text-center py-4 px-2 leading-relaxed">No saved conversations yet — your chats will appear here.</p>
        )}
        {open && sessions.map(s => (
          <div key={s.session_id}
            className={`group relative rounded-lg px-2.5 py-2 cursor-pointer transition flex items-start gap-2 ${
              s.session_id === activeId ? 'bg-accent/10 border border-accent/30' : 'hover:bg-base-raised border border-transparent'
            }`}
            onClick={() => onSelect(s.session_id)}>
            <IconMessage className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-ink-faint" />
            <div className="min-w-0 flex-1">
              <p className={`text-xs truncate ${s.session_id === activeId ? 'text-white font-semibold' : 'text-ink-dim'}`}>
                <TypewriterTitle text={s.title || 'Untitled conversation'} play={!!s._justCreated} onDone={() => onTitleTyped(s.session_id)} />
              </p>
              <p className="text-[9px] text-ink-faint">{relativeTime(s.updated_at)} · {s.message_count || 0} msgs</p>
            </div>
            {confirmId === s.session_id ? (
              <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => { onDelete(s.session_id); setConfirmId(null); }}
                  className="text-[9px] text-risk-critical hover:underline">Delete</button>
                <button onClick={() => setConfirmId(null)} className="text-[9px] text-ink-faint hover:text-white">Cancel</button>
              </div>
            ) : (
              <button onClick={(e) => { e.stopPropagation(); setConfirmId(s.session_id); }} title="Delete conversation"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-faint hover:text-risk-critical flex-shrink-0">
                <IconTrash />
              </button>
            )}
          </div>
        ))}
        </div>
      </div>
  );
}

function HighlightCards({ highlights }) {
  if (!highlights?.length) return null;
  return (
    <div className="flex gap-1.5 mt-3 flex-wrap">
      {highlights.map((h, i) => {
        const c = COLOR_MAP[h.color] || COLOR_MAP.cyan;
        return (
          <span key={i} className={`${c.bg} ${c.border} border rounded-full px-2.5 py-1 flex items-center gap-1.5`}>
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot} flex-shrink-0`}/>
            <span className={`text-[11px] font-bold ${c.text}`}>{h.value}</span>
            <span className="text-[10px] text-ink-faint">{h.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function AlertBanner({ alert }) {
  if (!alert) return null;
  return (
    <div className="mt-3 flex items-center gap-2 bg-risk-critical/10 border border-risk-critical/30 rounded-lg px-3 py-2">
      <span className="text-risk-critical flex-shrink-0"><IconAlert className="w-4 h-4" /></span>
      <p className="text-[11px] text-risk-critical leading-snug">{alert}</p>
    </div>
  );
}

function SuggestionChips({ suggestions, onSend }) {
  if (!suggestions?.length) return null;
  return (
    <div className="mt-3.5">
      <p className="text-[9px] text-ink-faint font-mono uppercase tracking-widest mb-2">Suggested follow-ups</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => onSend(s)}
            className="bg-base border border-base-border hover:border-accent/60 text-ink-dim hover:text-accent px-3 py-1.5 rounded-xl text-xs transition-all flex items-center gap-1.5">
            <IconArrowUpRight className="w-3 h-3 text-accent opacity-70 flex-shrink-0" />{s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExplainableAIPanel({ confidence, reasoning, evidence }) {
  const [open, setOpen] = useState(false);
  if (confidence == null && !reasoning?.length && !evidence?.length) return null;
  const color = confidence >= 80 ? '#2CB67D' : confidence >= 60 ? '#FFFFFF' : confidence >= 40 ? '#F0A23D' : '#F1493F';
  return (
    <div className="mt-2 border border-base-border rounded-xl overflow-hidden bg-black/20">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-[10px] text-ink-faint hover:text-accent transition">
        <span className="flex items-center gap-1.5"><IconSparkle className="w-3 h-3" /> How I figured this out</span>
        <span className="flex items-center gap-2">
          {confidence != null && <span className="font-bold tabular" style={{ color }}>{confidence}% confidence</span>}
          <span className={`inline-block transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>▾</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-base-borderSoft">
          {confidence != null && (
            <div className="w-full bg-base h-1.5 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width:`${confidence}%`, background:color }} />
            </div>
          )}
          {reasoning?.length > 0 && (
            <div className="space-y-1.5">
              {reasoning.map((r, i) => (
                <p key={i} className="text-[11px] text-ink-dim leading-relaxed">{r}</p>
              ))}
            </div>
          )}
          {evidence?.length > 0 && (
            <div>
              <p className="text-[9px] text-ink-faint uppercase tracking-widest mb-1">Evidence sources</p>
              <div className="flex flex-wrap gap-1.5">
                {evidence.map((e, i) => (
                  <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-base border border-base-border text-ink-faint">{e}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ action, onSend }) {
  if (!action) return null;
  return (
    <button onClick={() => onSend(action.query)}
      className="mt-3 w-full flex items-center justify-center gap-2 bg-accent/10 hover:bg-accent/20 border border-accent/40 hover:border-accent/70 text-accent px-4 py-2 rounded-xl text-xs font-medium transition-all">
      <IconBolt className="w-3.5 h-3.5" />{action.label}
    </button>
  );
}

// Renders bold (**text**), line breaks, and bullet lines (•/-) as real
// paragraphs/lists instead of one dense run-on block of text.
function renderText(text) {
  // Defensive: the model is instructed never to draw a chart itself (a real
  // one renders from the bolded name:value pairs), but strip any fenced
  // code block it emits anyway rather than showing raw ```mermaid text.
  const cleaned = (text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[CHART:.*?\]|\[NETWORK:.*?\]|\[MAP:.*?\]/g, '')
    .trim();
  // Same defensive intent as the code-fence strip above: drop any markdown
  // pipe-table rows the model restates a chart's numbers in (a real chart
  // already renders from the bolded pairs, so this would just be a
  // duplicate, uglier copy of the same data).
  const lines = cleaned.split('\n').map(l => l.trim())
    .filter(Boolean)
    .filter(l => !/^\|.*\|$/.test(l) && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(l));

  function renderInline(line, key) {
    const parts = line.split(/(\*\*.*?\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={`${key}-${i}`} className="text-white font-semibold">{p.slice(2, -2)}</strong>
        : <React.Fragment key={`${key}-${i}`}>{p}</React.Fragment>
    );
  }

  const blocks = [];
  let bulletBuffer = [];
  const flushBullets = () => {
    if (bulletBuffer.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-none space-y-1.5 my-2">
          {bulletBuffer.map((l, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed">
              <span className="text-accent flex-shrink-0 mt-0.5">•</span>
              <span>{renderInline(l.replace(/^[•\-*]\s*/, ''), `b${i}`)}</span>
            </li>
          ))}
        </ul>
      );
      bulletBuffer = [];
    }
  };

  lines.forEach((line, idx) => {
    if (/^[•\-*]\s+/.test(line)) {
      bulletBuffer.push(line);
    } else {
      flushBullets();
      blocks.push(<p key={idx} className="text-sm leading-relaxed my-1.5">{renderInline(line, idx)}</p>);
    }
  });
  flushBullets();

  return blocks;
}

// Progressively reveals `fullText` character-by-character for a smooth typing
// effect when `active` is true. Reveal speed scales with length so a long
// answer types faster (never drags), and `onTick` fires each frame so the
// parent can keep the view pinned to the bottom as text grows. When inactive
// (e.g. a message loaded from history) the full text shows instantly.
function useTypewriter(fullText, active, onTick, onDone) {
  const [shown, setShown] = useState(active ? '' : (fullText || ''));
  const [done, setDone]   = useState(!active);
  const tickRef = useRef(onTick); tickRef.current = onTick;
  const doneRef = useRef(onDone); doneRef.current = onDone;

  useEffect(() => {
    if (!active) { setShown(fullText || ''); setDone(true); return; }
    const text = fullText || '';
    setShown(''); setDone(false);
    let i = 0, raf, last = 0;
    const step = Math.max(2, Math.round(text.length / 150)); // longer → reveal more per frame
    const tick = (now) => {
      if (!last) last = now;
      if (now - last >= 14) {
        last = now;
        i = Math.min(text.length, i + step);
        setShown(text.slice(0, i));
        tickRef.current?.();
      }
      if (i < text.length) raf = requestAnimationFrame(tick);
      else { setDone(true); doneRef.current?.(); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fullText, active]);

  return { shown, done };
}

function AIMessage({ m, onSend, onSpeak, speaking, animate, onType, onDone }) {
  const badge = INTENT_BADGE[m.intent] || INTENT_BADGE.general;
  const { shown, done } = useTypewriter(m.text, !!animate, onType, onDone);

  // Hide a dangling, not-yet-closed **bold** marker mid-type so it doesn't
  // flash as literal asterisks before the closing ** is revealed.
  let display = shown;
  if (!done && ((display.match(/\*\*/g) || []).length % 2) === 1) {
    display = display.replace(/\*\*(?=[^*]*$)/, '');
  }

  return (
    <div className="flex items-start gap-2.5 mb-5 animate-fade-up">
      <BotAvatar />
      <div className="flex-1 max-w-[85%] min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-full border ${badge.color}`}>
            {badge.label}
          </span>
          {m.timestamp && (
            <span className="text-[9px] text-ink-faint">
              {new Date(m.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}
            </span>
          )}
          {onSpeak && done && (
            <button onClick={() => onSpeak(m)} title={speaking ? 'Stop reading' : 'Read aloud'}
              className={`transition ${speaking ? 'text-accent' : 'text-ink-faint hover:text-accent'}`}>
              {speaking ? <IconSpeakerOff /> : <IconSpeaker />}
            </button>
          )}
        </div>

        <div className="text-ink">
          {renderText(done ? m.text : `${display}▌`)}
          {done && (
            <>
              <AlertBanner alert={m.alert} />
              <HighlightCards highlights={m.highlights} />
              {m.chartType && m.chartType !== 'table' && (m.chartData?.length || STAT_INTENTS.has(m.intent)) && <InlineStatChart text={m.text} highlights={m.highlights} chartType={m.chartType} forcedBars={m.chartData} />}
              {m.tableData && <InlineTable data={m.tableData} />}
              {m.ziaData && <div className="mt-3"><ZiaTextPanel data={m.ziaData} title="Zia MO Analysis" subtitle="Catalyst Zia · entities & methods extracted from the case narratives" /></div>}
              {NETWORK_INTENTS.has(m.intent) && <InlineNetworkGraph text={m.text} />}
              <SuggestionChips suggestions={m.suggestions} onSend={onSend} />
              <ActionButton action={m.action} onSend={onSend} />
            </>
          )}
        </div>

        {done && <ExplainableAIPanel confidence={m.confidence} reasoning={m.reasoning} evidence={m.evidence} />}
      </div>
    </div>
  );
}

function UserMessage({ m, userName, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(m.text);
  const [copied, setCopied]   = useState(false);
  const taRef = useRef(null);

  useEffect(() => { if (editing) { taRef.current?.focus(); taRef.current?.select(); } }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== m.text) onEdit(trimmed);
  };

  const copy = () => {
    navigator.clipboard?.writeText(m.text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-end gap-2.5 mb-5 flex-row-reverse animate-fade-up group">
      <UserAvatar name={userName} />
      <div className="max-w-[75%]">
        {editing ? (
          <div className="bg-base-raised border border-accent/50 rounded-2xl rounded-br-sm px-3 py-2.5">
            <textarea
              ref={taRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') { setDraft(m.text); setEditing(false); } }}
              rows={2}
              className="w-full bg-transparent outline-none text-sm text-white resize-none"
            />
            <div className="flex justify-end gap-2 mt-1.5">
              <button onClick={() => { setDraft(m.text); setEditing(false); }} className="text-[10px] text-ink-faint hover:text-white px-2 py-1">Cancel</button>
              <button onClick={save} className="text-[10px] bg-accent text-base font-semibold px-2.5 py-1 rounded-lg">Save &amp; resend</button>
            </div>
          </div>
        ) : (
          <div className="bg-accent text-base font-medium px-4 py-3 rounded-2xl rounded-br-sm text-sm leading-relaxed">
            {m.text}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 mt-1 px-1">
          {!editing && (
            <>
              <button onClick={() => setEditing(true)} title="Edit &amp; resend"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-faint hover:text-accent flex items-center gap-1">
                <IconEdit />
              </button>
              <button onClick={copy} title="Copy message"
                className="opacity-0 group-hover:opacity-100 transition-opacity text-ink-faint hover:text-accent flex items-center gap-1">
                {copied ? <IconCheck className="w-3.5 h-3.5 text-risk-low" /> : <IconCopy />}
              </button>
            </>
          )}
          {m.timestamp && <p className="text-[9px] text-ink-faint">{new Date(m.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}</p>}
        </div>
      </div>
    </div>
  );
}

function welcomeMessage(user) {
  return {
    sender: 'ai',
    text: `Namaskara${user?.firstName ? ', ' + user.firstName : ''}. I am **KAVACH**, your crime intelligence assistant.\n\nI have direct access to live case records across Karnataka — FIRs, accused, victims, arrests, and financial links. Ask me anything in English or ಕನ್ನಡ.`,
    intent: 'general',
    highlights: [
      { label: 'Cases indexed',    value: '500+', color: 'cyan'  },
      { label: 'Districts',        value: '10',   color: 'blue'  },
      { label: 'Repeat offenders', value: '290+', color: 'amber' },
    ],
    suggestions: [
      'Show top repeat offenders across Karnataka',
      'Which district has the most cases?',
      'Who is not yet arrested?',
    ],
    action: { label: 'Run full crime pattern analysis', query: 'Give me a complete crime pattern analysis across all districts' },
    alert: null,
    evidence: ['Karnataka Crime Records System'],
    confidence: 95,
    reasoning: ['Static greeting — no live query executed yet.'],
    timestamp: Date.now(),
  };
}

export default function Chat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(chatKey(user?.id));
      if (saved) { const parsed = JSON.parse(saved); if (parsed?.length) return parsed; }
    } catch {}
    return [welcomeMessage(user)];
  });

  const [input, setInput]             = useState('');
  const [lang, setLang]               = useState('en');
  const [isListening, setIsListening] = useState(false);
  const [loading, setLoading]         = useState(false);
  // Timestamp of the one AI message currently playing its typewriter reveal —
  // set when a fresh reply arrives, cleared when it finishes. History-loaded
  // messages have no match here, so they render instantly (no re-animation).
  const [animatingTs, setAnimatingTs] = useState(null);
  const [autoSpeak, setAutoSpeak]     = useState(() => { try { return localStorage.getItem(AUTOSPEAK_KEY) === '1'; } catch { return false; } });
  const [speakingId, setSpeakingId]   = useState(null);
  const [sessionId, setSessionId]     = useState(() => { try { return localStorage.getItem(sessKey(user?.id)) || null; } catch { return null; } });
  const [sessions, setSessions]       = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef   = useRef(null);
  const langRef    = useRef(lang);
  langRef.current  = lang;
  const historyMenuRef = useRef(null);

  // Chat history lives behind the "⋯" trigger, not a permanent sidebar —
  // close it on outside click, same as any dropdown menu.
  useEffect(() => {
    if (!historyOpen) return;
    const onClick = (e) => { if (historyMenuRef.current && !historyMenuRef.current.contains(e.target)) setHistoryOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [historyOpen]);

  // Server-persisted conversation history — loaded once per user and
  // refreshed after every new/deleted/renamed session.
  const refreshSessions = () => {
    if (!user?.id) { setSessionsLoading(false); return; }
    listChatSessions(user.id).then(d => setSessions(d?.sessions || [])).catch(() => {}).finally(() => setSessionsLoading(false));
  };
  useEffect(() => { refreshSessions(); }, [user?.id]);

  // If the signed-in user changes while Chat stays mounted, swap the transcript
  // to that user's own cached conversation (or a fresh one) — never leave the
  // previous officer's chat on screen.
  const prevUidRef = useRef(user?.id);
  useEffect(() => {
    if (prevUidRef.current === user?.id) return;
    prevUidRef.current = user?.id;
    let restored = null;
    try { const saved = localStorage.getItem(chatKey(user?.id)); if (saved) { const p = JSON.parse(saved); if (p?.length) restored = p; } } catch {}
    setMessages(restored || [welcomeMessage(user)]);
    try { setSessionId(localStorage.getItem(sessKey(user?.id)) || null); } catch { setSessionId(null); }
  }, [user?.id]);

  const startNewChat = () => {
    const fresh = [welcomeMessage(user)];
    setMessages(fresh);
    setSessionId(null);
    setHistoryOpen(false);
    try { localStorage.setItem(chatKey(user?.id), JSON.stringify(fresh)); localStorage.removeItem(sessKey(user?.id)); } catch {}
  };

  const openSession = async (id) => {
    setHistoryOpen(false);
    if (id === sessionId || loading) return;
    setSessionId(id);
    try { localStorage.setItem(sessKey(user?.id), id); } catch {}
    setLoading(true);
    try {
      const d = await getChatSessionMessages(id);
      const loaded = (d?.messages || []).map(m => ({ ...m, sender: m.sender === 'ai' ? 'ai' : 'user' }));
      setMessages(loaded.length ? loaded : [welcomeMessage(user)]);
    } catch { /* keep whatever was showing */ }
    setLoading(false);
  };

  const removeSession = async (id) => {
    setSessions(prev => prev.filter(s => s.session_id !== id));
    if (id === sessionId) startNewChat();
    try { await deleteChatSession(id); } catch {}
  };

  // Clears the "play the typewriter reveal" flag once a freshly-created
  // session's title has finished animating in, so it won't replay if the
  // history menu is closed and reopened.
  const markTitleTyped = (id) => {
    setSessions(prev => prev.map(s => s.session_id === id ? { ...s, _justCreated: false } : s));
  };

  // Voice output — Web Speech synthesis. Kannada replies (or ಕನ್ನಡ mode) get
  // the kn-IN voice when the browser has one; otherwise falls back gracefully.
  const speakMessage = (m) => {
    const synth = window.speechSynthesis;
    if (!synth) { alert('Voice output requires Chrome, Edge, or Safari.'); return; }
    const id = m.timestamp;
    if (speakingId === id) { synth.cancel(); setSpeakingId(null); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(ttsCleanText(m.text).slice(0, 1200));
    const isKannada = /[ಀ-೿]/.test(m.text) || langRef.current === 'kn';
    u.lang = isKannada ? 'kn-IN' : 'en-IN';
    const voices = synth.getVoices();
    u.voice = voices.find(v => v.lang === u.lang)
      || voices.find(v => v.lang.startsWith(isKannada ? 'kn' : 'en-IN'))
      || voices.find(v => v.lang.startsWith('en'))
      || null;
    u.rate = 1.02;
    u.onend   = () => setSpeakingId(cur => (cur === id ? null : cur));
    u.onerror = () => setSpeakingId(cur => (cur === id ? null : cur));
    setSpeakingId(id);
    synth.speak(u);
  };

  const toggleAutoSpeak = () => {
    setAutoSpeak(v => {
      const next = !v;
      try { localStorage.setItem(AUTOSPEAK_KEY, next ? '1' : '0'); } catch {}
      if (!next) { window.speechSynthesis?.cancel(); setSpeakingId(null); }
      return next;
    });
  };

  const autoSpeakRef = useRef(autoSpeak);
  autoSpeakRef.current = autoSpeak;

  // Stop speech when leaving the page
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Persist across reloads (per-user key)
  useEffect(() => {
    try { localStorage.setItem(chatKey(user?.id), JSON.stringify(messages)); } catch {}
  }, [messages, user?.id]);

  const handleVoiceInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice requires Chrome or Safari.'); return; }
    if (isListening) return;
    const rec = new SR();
    rec.lang = lang === 'en' ? 'en-IN' : 'kn-IN';
    rec.start();
    rec.onstart  = () => setIsListening(true);
    rec.onresult = (e) => { setInput(e.results[0][0].transcript); setIsListening(false); inputRef.current?.focus(); };
    rec.onerror  = () => setIsListening(false);
    rec.onend    = () => setIsListening(false);
  };

  // Shared send path used both for new messages and edited-message resends.
  // `baseMessages` is everything that should stay in the transcript BEFORE
  // this query (for an edit, that's the transcript truncated to the point
  // of the edited message, dropping the old message and everything after it).
  const sendQuery = async (query, baseMessages) => {
    const userMsg = { sender: 'user', text: query, timestamp: Date.now() };
    const history = [...baseMessages, userMsg];
    setMessages(history);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/server/ksp_crimint_function/chat-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: query,
          language: lang,
          sessionId,
          user: {
            id: user?.id || null,
            role: user?.role || 'investigator',
            name: user?.firstName || 'Officer',
          },
          history: history.slice(-6).map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text,
          })),
        }),
      });
      const data = await res.json();
      const aiMsg = {
        sender:      'ai',
        text:        data.reply || 'No response received.',
        intent:      data.intent || 'general',
        chartType:   data.chartType || null,
        chartData:   data.chartData || null,
        tableData:   data.tableData || null,
        ziaData:     data.ziaData || null,
        highlights:  data.highlights || [],
        suggestions: data.suggestions || [],
        action:      data.action || null,
        alert:       data.alert || null,
        evidence:    data.sources || [],
        confidence:  data.confidence ?? null,
        reasoning:   data.reasoning || [],
        timestamp:   Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);
      setAnimatingTs(aiMsg.timestamp);           // play the typing reveal for this reply
      if (autoSpeakRef.current) speakMessage(aiMsg);

      // The server creates/persists the session — pick up its id, and if it
      // just rephrased a title (first turn), reflect that in the sidebar
      // immediately instead of waiting on a full re-fetch.
      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
        try { localStorage.setItem(sessKey(user?.id), data.sessionId); } catch {}
      }
      if (data.sessionId && data.sessionTitle) {
        setSessions(prev => [
          { session_id: data.sessionId, title: data.sessionTitle, message_count: 2, updated_at: new Date().toISOString(), created_at: new Date().toISOString(), _justCreated: true },
          ...prev.filter(s => s.session_id !== data.sessionId),
        ]);
      } else if (data.sessionId) {
        setSessions(prev => {
          const idx = prev.findIndex(s => s.session_id === data.sessionId);
          if (idx === -1) return prev;
          const updated = { ...prev[idx], updated_at: new Date().toISOString(), message_count: (prev[idx].message_count||0) + 2 };
          return [updated, ...prev.filter(s => s.session_id !== data.sessionId)];
        });
      }
    } catch {
      setMessages(prev => [...prev, {
        sender: 'ai', text: 'Connection error. Please retry.',
        intent: 'general', highlights: [], suggestions: [], action: null, alert: null,
        evidence: [], confidence: null, reasoning: [], timestamp: Date.now(),
      }]);
    }
    setLoading(false);
  };

  const handleSend = (textToSend = input) => {
    const query = textToSend.trim();
    if (!query || loading) return;
    sendQuery(query, messages);
  };

  // Editing a past message discards it and everything after it, then
  // re-asks with the edited text — the transcript "looks up again" from
  // that point instead of just replacing the text in place.
  const handleEditMessage = (msgIndex, newText) => {
    if (loading) return;
    const baseMessages = messages.slice(0, msgIndex);
    sendQuery(newText, baseMessages);
  };

  // Primary: server-side SmartBrowz render (real Chromium → '→' and Kannada
  // glyphs render correctly). Falls back to the local jsPDF build if the
  // SmartBrowz service isn't provisioned.
  const exportPDF = () => {
    const subtitle = `${user?.firstName||''} ${user?.lastName||''} · Badge: ${user?.badgeNumber||'N/A'} · ${user?.station||''}`.trim();
    const meta = `Exported ${new Date().toLocaleString('en-IN')}`;
    const sections = messages.map((m) => {
      const who = m.sender === 'user' ? (user?.firstName || 'Officer') : 'KAVACH';
      const when = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '';
      const cleaned = (m.text || '')
        .replace(/```[\s\S]*?```/g, '').replace(/\[.*?\]/g, '')
        .split('\n').map(l => l.trim())
        .filter(l => l && !/^\|.*\|$/.test(l) && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(l));
      const section = { heading: `${who} · ${when}`, paragraphs: cleaned };
      if (m.tableData?.columns && m.tableData?.rows) section.table = { head: m.tableData.columns, rows: m.tableData.rows };
      return section;
    });
    const html = buildReportHtml({ title: 'Conversation Log', subtitle, meta, sections });
    return serverPdf(html, `KAVACH_Conversation_${Date.now()}.pdf`, exportPDFLocal);
  };

  const exportPDFLocal = () => {
    const headerInfo = {
      title: 'Conversation Log',
      subtitle: `${user?.firstName||''} ${user?.lastName||''} · Badge: ${user?.badgeNumber||'N/A'} · ${user?.station||''}`.trim(),
      meta: `Exported ${new Date().toLocaleString('en-IN')}`,
    };
    const doc = createReportDoc(headerInfo);
    let y = 40;
    messages.forEach((m, i) => {
      if (y > PDF_LAYOUT.FOOTER_Y - 15) { doc.addPage(); y = PDF_LAYOUT.HEADER_H + 10; }
      const who = m.sender === 'user' ? (user?.firstName || 'Officer') : 'KAVACH';
      y = sectionHeading(doc, `${who} · ${m.timestamp ? new Date(m.timestamp).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : ''}`, y);
      const cleaned = (m.text || '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\[.*?\]/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => !/^\|.*\|$/.test(l) && !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(l))
        .join('\n')
        .trim();
      y = markdownParagraph(doc, cleaned, y);
      if (m.tableData?.columns && m.tableData?.rows) {
        y += 2;
        y = brandedTable(doc, {
          head: m.tableData.columns,
          body: m.tableData.rows.map(r => r.map(v => (v === null || v === undefined || v === '') ? '—' : String(v))),
          startY: y,
        });
      }
      y += 3;
    });
    finalizeDoc(doc, headerInfo);
    doc.save(`KAVACH_Conversation_${Date.now()}.pdf`);
  };

  return (
    <div className="flex flex-col h-full bg-base text-ink">

      {/* Header */}
      <div className="flex justify-between items-center border-b border-base-border px-5 py-3 flex-shrink-0 bg-base-panel/60 backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-base-raised to-base-border border border-accent/50">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="8" r="3.5" fill="#FFFFFF"/>
              <rect x="7" y="13" width="10" height="6" rx="2" fill="#FFFFFF" opacity="0.8"/>
              <circle cx="10" cy="8" r="1.2" fill="#000000"/>
              <circle cx="14" cy="8" r="1.2" fill="#000000"/>
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-display font-bold text-accent">KAVACH Intelligence Engine</h1>
              <span className="text-[9px] bg-risk-low/15 text-risk-low border border-risk-low/40 px-2 py-0.5 rounded-full font-mono">ONLINE</span>
            </div>
            <p className="text-[10px] text-ink-faint font-mono">Karnataka Crime Records · Live case, accused &amp; financial data</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex items-center bg-base-raised border border-base-border rounded-lg overflow-hidden text-xs"
            title="Answer language — you can type in English, ಕನ್ನಡ, or Kannada in English letters either way">
            <span className="text-[9px] text-ink-faint uppercase tracking-widest pl-2.5 pr-1.5 select-none">Answer</span>
            {[['en','EN'],['kn','ಕನ್ನಡ']].map(([code,label]) => (
              <button key={code} onClick={() => setLang(code)}
                className={`px-3 py-1.5 transition font-medium ${lang===code?'bg-accent text-base font-bold':'text-ink-faint hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={toggleAutoSpeak} title={autoSpeak ? 'Voice replies: ON — click to mute' : 'Voice replies: OFF — click to enable'}
            className={`px-3 py-1.5 rounded-lg text-xs transition border flex items-center gap-1.5 ${
              autoSpeak
                ? 'bg-accent text-base border-accent font-medium'
                : 'bg-base-raised border-base-border text-ink-faint hover:text-white'
            }`}>
            {autoSpeak ? <IconSpeaker /> : <IconSpeakerOff />}
            <span className="hidden sm:inline">{autoSpeak ? 'Voice on' : 'Voice off'}</span>
          </button>
          <button onClick={exportPDF} disabled={messages.length<=1}
            className="bg-risk-low/15 hover:bg-risk-low/25 disabled:opacity-40 border border-risk-low/40 px-3 py-1.5 rounded-lg text-xs font-medium transition text-risk-low flex items-center gap-1.5">
            <IconDownload className="w-3 h-3" /> PDF
          </button>
          <div className="relative" ref={historyMenuRef}>
            <button onClick={() => setHistoryOpen(o => !o)} title="Chat history"
              className={`p-2 rounded-lg transition border flex items-center justify-center ${
                historyOpen ? 'bg-accent/15 border-accent/40 text-accent' : 'bg-base-raised border-base-border text-ink-faint hover:text-white'
              }`}>
              <IconDots />
            </button>
            <HistoryMenu
              open={historyOpen}
              sessions={sessions} activeId={sessionId} loading={sessionsLoading}
              onNew={startNewChat} onSelect={openSession} onDelete={removeSession}
              onTitleTyped={markTitleTyped}
            />
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-5">
        {messages.length === 1 && (
          <div className="mb-6 animate-fade-up">
            <p className="text-[10px] text-ink-faint font-mono uppercase tracking-widest mb-2">Quick queries</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s,i) => (
                <button key={i} onClick={() => handleSend(s)}
                  className="bg-base-raised hover:bg-base-border/60 border border-base-border hover:border-accent/50 text-ink-dim hover:text-accent px-3 py-2 rounded-xl text-xs transition">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, idx) =>
          m.sender === 'user'
            ? <UserMessage key={idx} m={m} userName={user?.firstName} onEdit={(text) => handleEditMessage(idx, text)} />
            : <AIMessage   key={idx} m={m} onSend={handleSend} onSpeak={speakMessage} speaking={speakingId === m.timestamp}
                animate={m.timestamp != null && m.timestamp === animatingTs}
                onType={() => chatEndRef.current?.scrollIntoView({ behavior: 'auto' })}
                onDone={() => setAnimatingTs(t => (t === m.timestamp ? null : t))} />
        )}

        {loading && <TypingIndicator />}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-base-border p-4 bg-base-panel/60 backdrop-blur">
        <div className="flex gap-2 items-center bg-base-raised border border-base-border focus-within:border-accent/60 rounded-2xl px-3 py-2 transition-all">
          <button onClick={handleVoiceInput} title="Voice input"
            className={`p-2 rounded-full transition flex-shrink-0 flex items-center justify-center ${isListening?'bg-risk-critical animate-pulse text-white':'bg-base-border hover:bg-accent hover:text-base text-ink-dim'}`}>
            <IconMic />
          </button>
          <input ref={inputRef} type="text" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key==='Enter' && !e.shiftKey && handleSend()}
            placeholder={lang==='en'
              ? 'Ask about cases, accused, victims, or trends…'
              : 'ಅಪರಾಧ ಡೇಟಾಬೇಸ್ ಅನ್ನು ಪ್ರಶ್ನಿಸಿ…'}
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder-ink-faint py-1"/>
          <button onClick={() => handleSend()} disabled={!input.trim()||loading}
            className="bg-accent disabled:opacity-40 disabled:cursor-not-allowed text-base font-bold px-5 py-1.5 rounded-xl text-sm hover:opacity-90 transition">
            Analyze
          </button>
        </div>
        <p className="text-[10px] text-ink-faint font-mono mt-2 text-center">
          Ask in English, ಕನ್ನಡ, or Kannada in English letters ("Bengaluru alli eshtu kesu ide?") · conversation saved to your account
        </p>
      </div>

      <style>{`
        @keyframes kbounce {
          0%,100%{transform:translateY(0);opacity:.5}
          50%{transform:translateY(-6px);opacity:1}
        }
      `}</style>
    </div>
  );
}
