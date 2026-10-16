/** 架空の人物・画像だけで表示部品を検証する。PNGは実際に描画・再読込する。 */
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { MediaCatalogProvider } from "../components/MediaCatalogProvider";
import { PublicPlayerPhoto, PublicTeamLogo } from "../components/PublicMediaImage";
import { TeamDetailPublicMediaScope, TeamDetailPublicLogo, TeamDetailPublicPlayerPhoto } from "../components/TeamDetailPublicMedia";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { TeamLogo } from "../components/TeamLogo";
import { createMediaCatalogLoader, type MediaCatalogFetch } from "./mediaCatalogLoader";
import { renderExportCanvas } from "./exportImage";
import type { MediaRequest, MediaCatalog } from "../../shared/mediaCatalog";
const host = document.getElementById("root")!;
const results: { name: string; error?: string }[] = [];
const failedImages: string[] = [];
document.addEventListener("error", event => { if (event.target instanceof HTMLImageElement) failedImages.push(event.target.src); }, true);
const baseUrl = "/bleague-stats/";
const date = "2032-10-01T00:00:00Z";
const request = { kind: "player", context: "team", playerId: "fictional-player", teamId: "fictional-A", season: "2030-31" } as const;
function fixture(season = "2030-31", id = "red", teamId = "fictional-A", kind: "player" | "team" = "player"): MediaCatalog {
  const subject = kind === "player" ? { kind, playerId: "fictional-player", teamId } : { kind, teamId };
  return { schemaVersion: 1, assets: [{ assetId: id, subject, path: `media/assets/${id}.png`, sha256: "a".repeat(64), source: { reference: "fixture", checkedAt: date }, rights: { status: "confirmed", web: "granted", export: "granted", redistribute: "granted", evidence: "fixture", checkedAt: date } }],
    bindings: [{ bindingId: `b-${id}`, assetId: id, subject, season, verification: { chronology: "confirmed", affiliation: "confirmed", evidence: "fixture", checkedAt: date } }] };
}
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(data) });
const loader = (fetcher: MediaCatalogFetch) => createMediaCatalogLoader({ baseUrl, fetcher });
const photo = () => host.querySelector<HTMLImageElement>("img.player-photo");
function assert(v: unknown, m = "assertion failed"): asserts v { if (!v) throw new Error(m); }
async function until(check: () => boolean) {
  const end = performance.now() + 15000;
  while (!check()) { if (performance.now() > end) throw new Error("timeout: " + host.innerHTML.slice(0,500)); await new Promise(requestAnimationFrame); }
}
async function imageReady(selector = "img") {
  await until(() => [...host.querySelectorAll<HTMLImageElement>(selector)].every(i => i.complete && i.naturalWidth > 0));
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
let root: Root;
async function check(name: string, fn: () => Promise<void>) {
  root = createRoot(host);
  try { await fn(); results.push({ name }); }
  catch (e) { results.push({ name, error: String(e) }); }
  finally { flushSync(() => root.unmount()); host.replaceChildren(); }
}
async function run() {
  await check("未登録404は従来写真と同じURL・寸法・class・img", async () => {
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={loader(async () => response({},404))}><PublicPlayerPhoto request={request} size={32} className="player-cell-photo" /></MediaCatalogProvider>);
    await until(() => !!photo()); await imageReady();
    const img = photo()!; assert(img.getAttribute("src") === baseUrl + "data/player-photos/fictional-player.webp");
    assert(img.width === 32 && img.height === 32 && img.className === "player-photo player-cell-photo");
    assert(host.children.length === 1 && host.firstElementChild === img, "wrapper added");
    assert(!host.querySelector('[data-media-mode],[data-html2canvas-ignore]'));
  });
  await check("対応表の通信失敗でも現在写真", async () => {
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={loader(async () => { throw new Error("offline"); })}><PublicPlayerPhoto request={request} /></MediaCatalogProvider>);
    await until(() => !!photo()); await imageReady(); assert(photo()!.src.endsWith("/data/player-photos/fictional-player.webp"));
  });
  await check("登録画像404から現在画像へ戻る", async () => {
    const errorsBefore = failedImages.length;
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={loader(async () => response(fixture("2030-31","missing")))}><PublicPlayerPhoto request={request} size={32} /></MediaCatalogProvider>);
    await until(() => failedImages.length > errorsBefore && !!photo()?.src.endsWith("/data/player-photos/fictional-player.webp") && !!photo()?.complete);
    await imageReady();
  });
  await check("登録ロゴ404も現在ロゴ", async () => {
    const errorsBefore = failedImages.length;
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={loader(async () => response(fixture("2030-31","missing","fictional-A","team")))}><PublicTeamLogo request={{ ...request, kind: "team", playerId: undefined }} size={56} /></MediaCatalogProvider>);
    await until(() => failedImages.length > errorsBefore && !!host.querySelector<HTMLImageElement>(".team-logo")?.src.endsWith("/data/logos/fictional-A.png")); await imageReady();
  });
  await check("同一選手のシーズン別画像・通常のimg", async () => {
    const source = loader(async url => response(fixture(url.includes("2031-32") ? "2031-32" : "2030-31", url.includes("2031-32") ? "blue" : "red")));
    const view = (season: string) => <MediaCatalogProvider seasons={[season]} loader={source}><PublicPlayerPhoto request={{ ...request, season }} size={32} /></MediaCatalogProvider>;
    root.render(view("2030-31")); await until(() => !!photo()?.src.endsWith("/red.png")); await imageReady();
    flushSync(() => root.render(view("2031-32"))); assert(!photo()?.src.endsWith("/red.png"), "old image before effect");
    await until(() => !!photo()?.src.endsWith("/blue.png")); await imageReady(); assert(photo()!.tagName === "IMG");
  });
  await check("画像失敗の状態を次シーズンへ持ち越さない", async () => {
    const errorsBefore = failedImages.length;
    let missingRequested = false;
    const source = loader(async url => { const next = url.includes("2031-32"); if (!next) missingRequested = true; return response(fixture(next ? "2031-32" : "2030-31", next ? "blue" : "missing")); });
    const view = (season: string) => <MediaCatalogProvider seasons={[season]} loader={source}><PublicPlayerPhoto request={{ ...request, season }} /></MediaCatalogProvider>;
    root.render(view("2030-31")); await until(() => missingRequested && failedImages.length > errorsBefore);
    await until(() => !!photo()?.src.includes("/data/player-photos/"));
    root.render(view("2031-32")); await until(() => !!photo()?.src.endsWith("/blue.png")); await imageReady();
  });
  await check("A→B→Aの古い対応表・古い画像errorを破棄", async () => {
    const gate = deferred<ReturnType<typeof response>>();
    const source = loader(async url => url.includes("2030-31") ? gate.promise : response(fixture("2031-32", "blue")));
    const view = (season: string) => <MediaCatalogProvider seasons={[season]} loader={source}><PublicPlayerPhoto request={{ ...request, season }} /></MediaCatalogProvider>;
    root.render(view("2030-31")); await until(() => !!host.querySelector("span.player-photo"));
    assert(!photo(), "pending request must not show the current photo");
    root.render(view("2031-32")); await until(() => !!photo()?.src.endsWith("/blue.png")); const old = photo()!;
    flushSync(() => root.render(view("2030-31"))); assert(!photo()?.src.endsWith("/blue.png"));
    gate.resolve(response(fixture("2030-31","red"))); await until(() => !!photo()?.src.endsWith("/red.png"));
    old.dispatchEvent(new Event("error")); await new Promise(requestAnimationFrame);
    assert(photo()!.src.endsWith("/red.png"));
  });
  await check("別チームの画像は選ばない", async () => {
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={loader(async () => response(fixture("2030-31","red","fictional-B")))}><PublicPlayerPhoto request={request} /></MediaCatalogProvider>);
    await until(() => !!photo()); await imageReady(); assert(photo()!.src.includes("/data/player-photos/"));
  });
  await check("最終所属が不明なら現在画像・既知なら最終所属", async () => {
    const source = loader(async () => response(fixture("2030-31","red","fictional-B")));
    const seasonRequest: MediaRequest & { kind: "player"; playerId: string } = { ...request, context: "season", teamId: undefined };
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={source}><PublicPlayerPhoto request={seasonRequest} /></MediaCatalogProvider>);
    await until(() => !!photo()); await imageReady(); assert(photo()!.src.includes("/data/player-photos/"));
    root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={source}><PublicPlayerPhoto request={seasonRequest} affiliations={[{ playerId: "fictional-player", season: "2030-31", teamId: "fictional-B", status: "confirmed", evidence: "fixture", checkedAt: date }]} /></MediaCatalogProvider>);
    await until(() => !!photo()?.src.endsWith("/red.png"));
  });
  await check("現在画像自体が404なら既存のplaceholderを維持", async () => {
    root.render(<PublicPlayerPhoto request={{ ...request, playerId: "missing" }} placeholder size={32} />);
    await until(() => !!host.querySelector("span.player-photo-placeholder"));
    root.render(<PublicPlayerPhoto request={request} placeholder size={32} />);
    await until(() => !!photo()); await imageReady(); assert(!host.querySelector("span"));
  });
  await check("対応表で扱えない選手IDも従来PlayerPhotoと同じ表示経路を維持", async () => {
    for (const playerId of ["fictional:player", "架空 選手", "../invalid"]) {
      flushSync(() => root.render(<div><div id="legacy"><PlayerPhoto playerId={playerId} size={32} className="player-cell-photo" /></div><div id="public"><PublicPlayerPhoto request={{ ...request, playerId }} size={32} className="player-cell-photo" /></div></div>));
      const a=host.querySelector<HTMLImageElement>("#legacy img")!,b=host.querySelector<HTMLImageElement>("#public img");
      assert(b && b.getAttribute("src")===a.getAttribute("src") && b.className===a.className && b.width===a.width && b.height===a.height,"legacy ID behavior changed");
    }
  });
  await check("非表示になった現在画像もシーズン変更で状態を作り直す", async () => {
    root.render(<PublicPlayerPhoto request={{ ...request, playerId: "missing" }} />);
    await until(() => !!photo() && photo()!.style.display === "none");
    root.render(<PublicPlayerPhoto request={{ ...request, season: "2031-32" }} />);
    await until(() => !!photo()?.src.endsWith("/fictional-player.webp")); await imageReady();
    assert(photo()!.style.display !== "none");
  });
  await check("他チームは従来部品・対応表を取得しない", async () => {
    const calls: string[] = []; const original = window.fetch;
    window.fetch = (...args) => { calls.push(String(args[0])); return original(...args); };
    try {
      root.render(<TeamDetailPublicMediaScope season="2030-31" pageTeamId="fictional-A"><TeamDetailPublicLogo season="2030-31" pageTeamId="fictional-A" teamId="fictional-A"/><TeamDetailPublicPlayerPhoto season="2030-31" pageTeamId="fictional-A" playerId="fictional-player" /></TeamDetailPublicMediaScope>);
      await until(() => !!photo()); await imageReady(); assert(calls.length === 0);
    } finally { window.fetch = original; }
  });
  await check("期間つき単独画像を日付なしチーム表示で採用し複数候補は従来画像", async () => {
    const a=fixture();a.bindings[0]!.period={from:"2030-10-01",to:"2030-12-31"};
    const view=(data:MediaCatalog)=><MediaCatalogProvider seasons={["2030-31"]} loader={loader(async()=>response(data))}><PublicPlayerPhoto request={request} size={32}/></MediaCatalogProvider>;
    root.render(view(a));await until(()=>!!photo()?.src.endsWith("/red.png"));await imageReady();
    const b=fixture("2030-31","blue");b.bindings[0]!.period={from:"2031-01-01",to:"2031-06-30"};
    root.render(view({schemaVersion:1,assets:[...a.assets,...b.assets],bindings:[...a.bindings,...b.bindings]}));
    await until(()=>!!photo()?.src.endsWith("/fictional-player.webp"));await imageReady();
  });
  await check("読み込み中は写真とロゴの同寸空枠で完了後の404は従来画像", async () => {
    const gate=deferred<ReturnType<typeof response>>();const source=loader(async()=>gate.promise);
    flushSync(()=>root.render(<MediaCatalogProvider seasons={["2030-31"]} loader={source}><div style={{display:"flex",alignItems:"center"}}><PublicPlayerPhoto request={request} size={32} className="player-cell-photo"/><PublicTeamLogo request={{...request,kind:"team",playerId:undefined}} size={56}/><span id="after-media">After</span></div></MediaCatalogProvider>));
    assert(!host.querySelector("img"),"current image requested during catalog loading");
    const photoBox=host.querySelector<HTMLElement>("span.player-photo")!,logoBox=host.querySelector<HTMLElement>("span.team-logo")!;
    assert(photoBox.getBoundingClientRect().width===32&&photoBox.getBoundingClientRect().height===32,"photo frame size");
    assert(logoBox.getBoundingClientRect().width===56&&logoBox.getBoundingClientRect().height===56,"logo frame size");
    const before=host.querySelector("#after-media")!.getBoundingClientRect().left;gate.resolve(response({},404));await until(()=>host.querySelectorAll("img").length===2);await imageReady();
    assert(host.querySelector("#after-media")!.getBoundingClientRect().left===before,"frame changed layout");
  });
  await check("season変更直後から新対応表完了まで現在画像も旧画像も表示しない", async()=>{
    const gate=deferred<ReturnType<typeof response>>();const source=loader(async url=>url.includes("2031-32")?gate.promise:response(fixture()));
    const view=(season:string)=><MediaCatalogProvider seasons={[season]} loader={source}><PublicPlayerPhoto request={{...request,season}} size={32}/></MediaCatalogProvider>;
    root.render(view("2030-31"));await until(()=>!!photo()?.src.endsWith("/red.png"));
    flushSync(()=>root.render(view("2031-32")));assert(!photo(),"image flashed before effect");assert(!!host.querySelector("span.player-photo"),"empty frame missing");
    gate.resolve(response({},503));await until(()=>!!photo()?.src.endsWith("/fictional-player.webp"));await imageReady();
  });
  await check("宇都宮と他チームの往復で子のタブ状態を保持し取得は宇都宮だけ", async()=>{
    const calls:string[]=[],original=window.fetch;
    window.fetch=async(...args)=>{calls.push(String(args[0]));return new Response(JSON.stringify({schemaVersion:1,assets:[],bindings:[]}),{status:200});};
    function Tabs(){const[tab,set]=useState("Traditional");return <button id="stateful-tab" onClick={()=>set("Shooting")}>{tab}</button>;}
    const view=(pageTeamId:string)=><TeamDetailPublicMediaScope season="2030-31" pageTeamId={pageTeamId}><Tabs/></TeamDetailPublicMediaScope>;
    try{root.render(view("703"));await until(()=>calls.length>0&&!!host.querySelector("#stateful-tab"));flushSync(()=>host.querySelector<HTMLButtonElement>("#stateful-tab")!.click());
      flushSync(()=>root.render(view("702")));assert(host.querySelector("#stateful-tab")?.textContent==="Shooting","tab remounted on leaving Utsunomiya");const count=calls.length;await new Promise(requestAnimationFrame);assert(calls.length===count,"non-Utsunomiya fetched catalog");
      flushSync(()=>root.render(view("703")));assert(host.querySelector("#stateful-tab")?.textContent==="Shooting","tab remounted on returning");assert(calls.every(url=>url.endsWith("/2030-31.json")),"wrong catalog request");
    }finally{window.fetch=original;}
  });
  await check("未登録写真・ロゴのPNGが既存部品と画素一致", async () => {
    const target = <div className="public-media-pixel-fixture" style={{ width: 180, height: 100, background: "white" }}><PlayerPhoto playerId="fictional-player" size={32} className="player-cell-photo"/><TeamLogo teamId="fictional-A" size={56}/><span>Amber 17</span></div>;
    root.render(target); await until(() => !!photo()); await imageReady();
    const before = await renderExportCanvas(host.firstElementChild as HTMLElement);
    root.render(<div className="public-media-pixel-fixture" style={{ width: 180, height: 100, background: "white" }}><PublicPlayerPhoto request={request} size={32} className="player-cell-photo"/><PublicTeamLogo request={{...request, kind:"team", playerId:undefined}} size={56}/><span>Amber 17</span></div>);
    await until(() => !!photo()); await imageReady();
    const after = await renderExportCanvas(host.firstElementChild as HTMLElement);
    async function pixels(canvas: HTMLCanvasElement) {
      const blob = await new Promise<Blob>((yes,no) => canvas.toBlob(b => b ? yes(b) : no(new Error("no PNG")),"image/png"));
      const bitmap = await createImageBitmap(blob); const c = document.createElement("canvas"); c.width=bitmap.width;c.height=bitmap.height;c.getContext("2d")!.drawImage(bitmap,0,0);bitmap.close();
      return c.getContext("2d")!.getImageData(0,0,c.width,c.height).data;
    }
    assert(before.canvas.width===after.canvas.width && before.canvas.height===after.canvas.height,"dimensions changed");
    const a=await pixels(before.canvas),b=await pixels(after.canvas); assert(a.length===b.length && a.every((v,i)=>v===b[i]),"pixel mismatch");
  });
}
run().catch(e=>results.push({name:"harness",error:String(e)})).finally(async()=>{ await fetch("/result",{method:"POST",body:JSON.stringify({viewport:innerWidth,total:results.length,passed:results.filter(r=>!r.error).length,failed:results.filter(r=>r.error).length,results})}); });
