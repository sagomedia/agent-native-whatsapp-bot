#!/usr/bin/env python3
# Dedicated inventory/draft role for this single-shop VPS; no public listener.
from pathlib import Path
import os,subprocess,secrets,pwd,urllib.parse,json
assert os.geteuid()==0
os.umask(0o077)
role='shopbot_catalog_mcp';envfile=Path('/etc/shopbot-catalog-mcp.env')
def sql(query):return subprocess.check_output(['runuser','-u','postgres','--','psql','-X','-At','-d','shopbot_vps_preview','-v','ON_ERROR_STOP=1','-c',query],text=True).strip()
exists=sql("SELECT count(*) FROM pg_roles WHERE rolname='"+role+"'")=='1'
if exists:
 assert envfile.is_file(),'An existing role needs its original private environment; do not reset credentials'
else:
 assert not envfile.exists()
 password=secrets.token_urlsafe(36)
 script=f"BEGIN; CREATE ROLE {role} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 2; GRANT CONNECT ON DATABASE shopbot_vps_preview TO {role}; GRANT USAGE ON SCHEMA public TO {role}; GRANT SELECT ON stores,products,catalog_nodes,catalog_profiles TO {role}; GRANT UPDATE(catalog_revision) ON stores TO {role}; GRANT SELECT,INSERT,UPDATE ON catalog_proposals,catalog_proposal_assets TO {role}; GRANT INSERT ON owner_audit TO {role}; GRANT USAGE ON SEQUENCE owner_audit_sequence_seq TO {role}; COMMIT;"
 subprocess.run(['runuser','-u','postgres','--','psql','-X','-q','-d','shopbot_vps_preview','-v','ON_ERROR_STOP=1'],input=script,text=True,stdout=subprocess.DEVNULL,check=True)
 envfile.write_text('SHOPBOT_MCP_DATABASE_URL=postgres://'+role+':'+password+'@127.0.0.1:5432/shopbot_vps_preview\nSHOPBOT_MCP_STORE_ID=00000000-0000-4000-8000-000000000001\nSHOPBOT_MCP_ACTOR=codex-catalog-owner\n')
 account=pwd.getpwnam('shopbot-vps');envfile.chmod(0o600);os.chown(envfile,account.pw_uid,account.pw_gid)
proof=json.loads(sql("SELECT json_build_object('inventoryRead',has_table_privilege('shopbot_catalog_mcp','products','SELECT'),'draftInsert',has_table_privilege('shopbot_catalog_mcp','catalog_proposals','INSERT'),'publishedProductWrite',has_table_privilege('shopbot_catalog_mcp','products','UPDATE'),'orderRead',has_table_privilege('shopbot_catalog_mcp','order_requests','SELECT'),'orderWrite',has_table_privilege('shopbot_catalog_mcp','order_requests','UPDATE'),'budgetRead',has_table_privilege('shopbot_catalog_mcp','inference_budgets','SELECT'))"))
assert proof['inventoryRead'] and proof['draftInsert'] and not any(proof[k] for k in ['publishedProductWrite','orderRead','orderWrite','budgetRead'])
print(json.dumps({'privateEnvironmentInstalled':True,'dedicatedInventoryRole':True,'permissions':proof}))
