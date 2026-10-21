const paths={
 today:'M3 10 12 3l9 7v11h-6v-7H9v7H3z',
 orders:'M6 3h12v18H6z M9 7h6 M9 12h6 M9 17h4',
 messages:'M3 4h18v13H9l-6 4z',
 products:'m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
 settings:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
 preview:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
};
export function OwnerIcon({name}:{name:keyof typeof paths}){
 return <svg className="owner-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
