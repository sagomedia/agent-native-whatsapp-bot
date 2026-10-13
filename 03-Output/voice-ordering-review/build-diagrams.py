from pathlib import Path
import html,json
root=Path(__file__).parent
palette={'ink':'#163047','muted':'#567083','paper':'#fafbf9','line':'#4c7c84','box':'#edf5f1','border':'#8dacac','accent':'#dfeee9'}
def diagram(name,title,nodes,edges,width=1200,height=660):
 items=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(title)}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="{palette["line"]}"/></marker></defs><rect width="100%" height="100%" fill="{palette["paper"]}"/><text x="35" y="48" font-size="30" fill="{palette["ink"]}" font-family="sans-serif" font-weight="bold">{html.escape(title)}</text>']
 for x1,y1,x2,y2,label in edges:
  items.append(f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{palette["line"]}" stroke-width="2.5" marker-end="url(#arrow)"/>')
  if label:items.append(f'<text x="{(x1+x2)/2}" y="{(y1+y2)/2-9}" font-size="16" text-anchor="middle" font-family="sans-serif" fill="{palette["muted"]}">{html.escape(label)}</text>')
 for x,y,w,h,label,details in nodes:
  items.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{palette["box"]}" stroke="{palette["border"]}"/><text x="{x+14}" y="{y+30}" font-size="21" font-family="sans-serif" fill="{palette["ink"]}" font-weight="bold">{html.escape(label)}</text>')
  for i,line in enumerate(details):items.append(f'<text x="{x+14}" y="{y+59+i*23}" font-size="16" font-family="sans-serif" fill="{palette["muted"]}">{html.escape(line)}</text>')
 items.append('</svg>');(root/(name+'.svg')).write_text(''.join(items))
diagram('runtime-map','Your running system: messages, understanding and storage',[
 (30,100,220,125,'Customer WhatsApp',['Voice / text / photo','Receives choices and bill']),
 (320,100,235,125,'Meta Cloud API',['Receives customer messages','Sends signed webhook']),
 (630,100,235,125,'Cloudflare route',['demo host: webhook/media','owner host: Access login']),
 (935,100,235,125,'ShopBot on VPS',['Fastify + workers','127.0.0.1:3017']),
 (30,330,280,115,'Shop owner browser',['Protected dashboard','Reply / approve / manage catalog']),
 (435,330,300,125,'Gemini 3.5 Flash Lite',['Interprets input evidence','Proposes type / count / edits','Does not authorize orders']),
 (870,330,300,125,'PostgreSQL 17',['Catalog, carts and messages','Orders, outbox and audit','Durable state survives restart']),
 (440,530,680,90,'ShopBot validates → customer chooses → reviews bill',['Final consent creates a request; shop confirms availability / final price'])
 ],[(250,160,315,160,'message'),(555,160,625,160,'HTTPS'),(865,160,930,160,'tunnel'),(1045,225,585,325,'bounded inference'),(1060,225,1040,325,'read / write'),(310,355,670,230,'owner Access'),(1040,455,790,525,'validated facts')])
diagram('code-to-vps','GitHub keeps code history. Deployment changes the running VPS.',[
 (30,105,255,125,'1  Fetch main',['Update remote references','Keep dirty checkout untouched']),
 (325,105,255,125,'2  Feature worktree',['Make changes on a branch','Commit + build + tests']),
 (620,105,255,125,'3  Push branch',['Publish commits to GitHub','Does not change the VPS']),
 (915,105,255,125,'4  Pull request',['Review diff + CI checks','Merge updates GitHub main']),
 (30,365,255,145,'5  Verified source',['Choose exact reviewed commit','Local replay + test evidence','Secrets stay outside Git']),
 (325,365,255,145,'6  Immutable bundle',['Build off-server','Manifest + archive checksum','Stage without activation']),
 (620,365,255,145,'7  Backup + activate',['Save database + configuration','Switch current symlink','Restart systemd service']),
 (915,365,255,145,'8  Verify / recover',['Readiness + URL checks','Confirm preserved records','Restore previous release if needed'])
 ],[(285,167,320,167,''),(580,167,615,167,''),(875,167,910,167,''),(1040,230,160,360,'approved source'),(285,430,320,430,''),(580,430,615,430,''),(875,430,910,430,'')],height=560)
diagram('pipe-decision','A shared word is not an exact product identity',[
 (30,115,285,135,'Customer says: two pipes',['Diameter: 1 inch','Type / brand / length: unknown']),
 (415,115,350,135,'Ask the missing identity',['PVC? Flexible watering hose?','Pump delivery / suction pipe?','Keep count = 2 and diameter = 1 inch']),
 (875,105,285,145,'Catalog match?',['Must support stated type / brand','Same size alone is insufficient','Missing item stays shop check']),
 (50,370,330,130,'Explicit PVC pipe',['Show matching PVC variants','Customer chooses actual product']),
 (435,370,330,130,'Explicit watering hose',['Show verified hose size / pack','Do not imply pump compatibility']),
 (825,370,330,130,'Pump pipe absent',['Keep requested item and amount','Shop must confirm type / stock','No PVC or 10m hose substitution'])
 ],[(315,177,410,177,'understand'),(765,177,870,177,'search'),(1040,250,990,365,''),(600,250,600,365,''),(460,250,210,365,'')],height=555)
print(json.dumps({'diagrams':list(p.name for p in root.glob('*.svg'))}))
