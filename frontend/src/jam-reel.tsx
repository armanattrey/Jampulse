import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { TiltedGridHero, type TiltedGridImage } from '@/components/ui/tilted-grid-hero';
import FUIBentoGridDark from '@/components/ui/bento';
import './reel.css';
type Jam={_id:string;title:string;vibe:string;startTime:string;locationName:string;distanceMeters:number;description?:string;instrumentsNeeded?:string[];hostTeam?:string;hostProfile?:{name?:string}};
type Bridge={getJams:()=>Jam[];getStatus:()=>string;select:(jam:Jam)=>void;contact:(jam:Jam)=>void;join:(id:string)=>Promise<void>;save:(id:string)=>void;isSaved:(id:string)=>boolean;isAttending:(jam:Jam)=>boolean};
declare global {interface Window {jampulseUI:Bridge}}
const category:Record<string,string>={'Acoustic Unplugged':'Acoustic','Electric Jam':'Electric','Open Mic':'Open mic','Sufi & Classical':'Sufi & classical','Chill Electronic':'Electronic','Jazz & Blues':'Jazz & blues'};
const palette=['#c8d3b5','#d8cfdf','#e2d4c1','#d5e4dc','#d5f66b','#cad4e0'];
const xml=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]!));
function poster(jam:Jam,index:number){
 const title=category[jam.vibe]||'Open jam';const lines=title.length>12?title.split(' & '):[title];const color=palette[index%palette.length];
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480"><rect width="720" height="480" rx="16" fill="${color}"/><text x="38" y="43" font-family="Arial,sans-serif" font-size="12" letter-spacing="4" fill="#34412c">JAMPULSE / LOCAL SESSIONS</text>${lines.map((line,i)=>`<text x="35" y="${137+i*67}" font-family="Arial,sans-serif" font-size="${lines.length>1?60:80}" font-weight="800" letter-spacing="-4" fill="#182016">${xml(line)}</text>`).join('')}<circle cx="365" cy="510" r="290" fill="#1c2419"/>${Array.from({length:38},(_,i)=>`<circle cx="365" cy="510" r="${75+i*5.6}" fill="none" stroke="#46523d" stroke-width="1.1"/>`).join('')}<circle cx="365" cy="510" r="74" fill="${color}"/><text x="38" y="450" font-family="Arial,sans-serif" font-size="12" letter-spacing="3" fill="#e5eddc">BRING YOUR SOUND.</text></svg>`;
 return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function timeLabel(jam:Jam){const date=new Date(jam.startTime);return Number.isFinite(date.getTime())?date.toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Time to be announced';}
function JamReel(){
 const [jams,setJams]=React.useState<Jam[]>(()=>window.jampulseUI?.getJams()||[]);
 const [error,setError]=React.useState(()=>window.jampulseUI?.getStatus()==='error');
 const [loading,setLoading]=React.useState(()=>window.jampulseUI?.getStatus()==='loading');
 const [selectedId,setSelectedId]=React.useState<string|null>(null);
 const [playing,setPlaying]=React.useState(false);const [hovering,setHovering]=React.useState(false);const [viewMode,setViewMode]=React.useState<'bento'|'reel'|'list'>('bento');const [busy,setBusy]=React.useState(false);
 const [,refresh]=React.useReducer(n=>n+1,0);
 const [reducedMotion,setReducedMotion]=React.useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 const gesture=React.useRef<{id:number;x:number;y:number;lastX:number;lastTime:number;velocity:number;horizontal:boolean}|null>(null);
 const suppressClick=React.useRef(false);
 React.useEffect(()=>{
  const receive=(event:Event)=>{const detail=(event as CustomEvent<{jams:Jam[];error?:boolean;loading?:boolean}>).detail;setJams(detail.jams);setError(Boolean(detail.error));setLoading(Boolean(detail.loading));refresh();};
  window.addEventListener('jampulse:jams',receive);setJams(window.jampulseUI.getJams());setError(window.jampulseUI.getStatus()==='error');setLoading(window.jampulseUI.getStatus()==='loading');document.querySelector('.content-wrapper')?.classList.add('reel-ready');
  const media=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReducedMotion(media.matches);media.addEventListener('change',change);
  return()=>{window.removeEventListener('jampulse:jams',receive);media.removeEventListener('change',change);};
 },[]);
 React.useEffect(()=>{document.querySelector('.content-wrapper')?.classList.toggle('view-list',viewMode==='list');},[viewMode]);
 const selectedIndex=Math.max(0,jams.findIndex(jam=>jam._id===selectedId));const selected=jams[selectedIndex];
 const images=React.useMemo(()=>jams.map((jam,index)=>({id:jam._id,src:poster(jam,index),alt:`Select ${jam.title}`})),[jams]);
 const select=(image:TiltedGridImage)=>{const jam=jams.find(item=>item._id===image.id);if(!jam)return;setSelectedId(jam._id);setPlaying(false);window.jampulseUI.select(jam);};
 const move=(step:number)=>{if(jams.length<2)return;select(images[(selectedIndex+step+jams.length)%jams.length]);};
 const resetDrag=(stage:HTMLDivElement)=>{
  stage.classList.remove('is-dragging');
  stage.style.setProperty('--reel-drag-angle','0deg');
 };
 const startDrag=(event:React.PointerEvent<HTMLDivElement>)=>{
  suppressClick.current=false;
  if(!event.isPrimary || event.button!==0 || jams.length<2)return;
  gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastTime:event.timeStamp,velocity:0,horizontal:false};
 };
 const drag=(event:React.PointerEvent<HTMLDivElement>)=>{
  const current=gesture.current;
  if(!current || current.id!==event.pointerId)return;
  const dx=event.clientX-current.x,dy=event.clientY-current.y;
  if(!current.horizontal){
   if(Math.abs(dy)>8 && Math.abs(dy)>Math.abs(dx)){gesture.current=null;return;}
   if(Math.abs(dx)<8 || Math.abs(dx)<=Math.abs(dy))return;
   current.horizontal=true;setPlaying(false);
   event.currentTarget.setPointerCapture(event.pointerId);
   event.currentTarget.classList.add('is-dragging');
  }
  event.preventDefault();
  const elapsed=event.timeStamp-current.lastTime;
  if(elapsed>0)current.velocity=(event.clientX-current.lastX)/elapsed;
  current.lastX=event.clientX;current.lastTime=event.timeStamp;
  const angle=Math.max(-55,Math.min(55,-dx/event.currentTarget.clientWidth*100));
  event.currentTarget.style.setProperty('--reel-drag-angle',`${angle}deg`);
 };
 const finishDrag=(event:React.PointerEvent<HTMLDivElement>,cancelled=false)=>{
  const current=gesture.current;
  if(!current || current.id!==event.pointerId)return;
  gesture.current=null;
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  if(current.horizontal){
   suppressClick.current=true;
   const dx=event.clientX-current.x;
   const threshold=Math.min(48,event.currentTarget.clientWidth*.13);
   const flick=event.timeStamp-current.lastTime<100 && Math.abs(current.velocity)>.45 && Math.abs(dx)>18;
   if(!cancelled && (Math.abs(dx)>=threshold || flick))move(dx<0?1:-1);
   resetDrag(event.currentTarget);

  }
 };
 return <div className="jam-reel-app">
  <div className="reel-toolbar"><div className="reel-view-tabs" role="group" aria-label="Choose how to browse jams"><button type="button" aria-pressed={viewMode==='bento'} onClick={()=>setViewMode('bento')}>Bento view</button><button type="button" aria-pressed={viewMode==='reel'} onClick={()=>setViewMode('reel')}>Curved reel</button><button type="button" aria-pressed={viewMode==='list'} onClick={()=>setViewMode('list')}>All sessions</button></div>{viewMode==='reel'&&<span className="reel-hint">Swipe or drag to find your circle.</span>}</div>
  {viewMode==='bento'&&jams.length>0&&<FUIBentoGridDark
   selectedId={selectedId || undefined}
   reduceMotion={reducedMotion}
   items={jams.map((jam,index)=>({id:jam._id,eyebrow:category[jam.vibe]||jam.vibe||'Open jam',title:jam.title,description:jam.description||'Bring your instrument and meet a local music circle.',image:images[index].src,date:timeLabel(jam),location:`${jam.locationName} · ${(jam.distanceMeters/1000).toFixed(1)} km`,host:jam.hostProfile?.name||jam.hostTeam||'Local musicians',instruments:jam.instrumentsNeeded||[],saved:window.jampulseUI.isSaved(jam._id),attending:window.jampulseUI.isAttending(jam)}))}
   onSelect={id=>{const image=images.find(item=>item.id===id);if(image)select(image);}}
   onContact={id=>{const jam=jams.find(item=>item._id===id);if(jam)window.jampulseUI.contact(jam);}}
   onSave={id=>window.jampulseUI.save(id)}
   onJoin={async id=>{await window.jampulseUI.join(id);refresh();}}
  />}
  {viewMode==='reel'&&selected&&<>
   <div className="reel-stage-wrap">
    <div className="reel-stage" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={event=>finishDrag(event)} onPointerCancel={event=>finishDrag(event,true)} onLostPointerCapture={event=>{if(event.target===event.currentTarget && gesture.current?.id===event.pointerId){gesture.current=null;resetDrag(event.currentTarget);}}} onClickCapture={event=>{if(suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}}} onMouseEnter={()=>setHovering(true)} onMouseLeave={()=>setHovering(false)} onFocus={()=>setHovering(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setHovering(false);}} tabIndex={0} aria-label="Jam session carousel" aria-roledescription="carousel" onKeyDown={event=>{if(event.key==='ArrowRight'){event.preventDefault();event.currentTarget.focus();move(1);}if(event.key==='ArrowLeft'){event.preventDefault();event.currentTarget.focus();move(-1);}}}>
     <div>
      <TiltedGridHero key={`${jams.map(jam=>jam._id).join('|')}:${selected._id}`} images={images} activeIndex={selectedIndex} onImageSelect={select} paused={!playing||hovering||reducedMotion||jams.length<2} speed={7} tileHeight={65} aspectRatio={1.5} gap={9} axis={50} curve={52} fade={8} className="jam-curved-band"/>
     </div>
    </div>
    <div className="reel-controls"><button className="reel-arrow" type="button" onClick={()=>move(-1)} disabled={jams.length<2} aria-label="Previous jam">←</button><span className="reel-position" aria-live="polite">{String(selectedIndex+1).padStart(2,'0')} <span>/ {String(jams.length).padStart(2,'0')}</span></span><button className="reel-arrow" type="button" onClick={()=>move(1)} disabled={jams.length<2} aria-label="Next jam">→</button>{!reducedMotion&&jams.length>1&&<button className="reel-play" type="button" onClick={()=>setPlaying(value=>!value)} aria-label={playing?'Pause moving jam reel':'Play moving jam reel'} aria-pressed={playing}>{playing?'Pause reel':'Play reel'}</button>}</div>
   </div>
   <article className="selected-jam" aria-label="Selected jam session" aria-live="polite">
    <div className="selected-jam-top"><span>{category[selected.vibe]||selected.vibe||'Open jam'}</span><button type="button" className="jam-save-trigger" aria-label={window.jampulseUI.isSaved(selected._id)?'Remove saved jam':'Save jam'} aria-pressed={window.jampulseUI.isSaved(selected._id)} onClick={()=>window.jampulseUI.save(selected._id)}>{window.jampulseUI.isSaved(selected._id)?'♥':'♡'}</button></div>
    <h3>{selected.title}</h3><div className="selected-jam-meta"><span>{timeLabel(selected)}</span><span>{selected.locationName} · {(selected.distanceMeters/1000).toFixed(1)} km</span></div><p>{selected.description||'Bring your instrument and meet a local music circle.'}</p>
    <div className="selected-jam-footer"><div className="selected-jam-host"><span className="host-monogram" aria-hidden="true">{(selected.hostProfile?.name||selected.hostTeam||'J').slice(0,1)}</span><span>Hosted by<strong>{selected.hostProfile?.name||selected.hostTeam||'Local musicians'}</strong></span></div><div className="card-actions"><button className="btn btn-outline" type="button" onClick={()=>window.jampulseUI.contact(selected)}>Contact</button><button className="btn btn-brand" type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await window.jampulseUI.join(selected._id);refresh();}finally{setBusy(false);}}}>{busy?'Joining…':window.jampulseUI.isAttending(selected)?'✓ In circle':'Ask to join ↗'}</button></div></div>
    {!!selected.instrumentsNeeded?.length&&<div className="selected-jam-instruments"><span>Bring your</span>{selected.instrumentsNeeded.map(instrument=><span className="tag-badge" key={instrument}>{instrument}</span>)}</div>}
   </article>
  </>}
  {viewMode!=='list'&&!selected&&loading&&<div className="reel-loading" role="status" aria-label="Loading nearby jam sessions"><div/><div/><span>Finding your local lineup…</span></div>}
  {viewMode!=='list'&&!selected&&!loading&&<div className="empty-jams"><h3>{error?'We couldn’t load the lineup.':'Your next circle is out there.'}</h3><p>{error?'Please try again in a moment.':'Try another sound, widen your distance, or host a session of your own.'}</p><button className="btn btn-outline" onClick={()=>document.getElementById(error?'retryJamsBtn':'clearFilters')?.click()}>{error?'Try again':'Reset filters'}</button></div>}
 </div>;
}
const root=document.getElementById('jamReelRoot');if(root)createRoot(root).render(<JamReel/>);
