const paths={
 search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 today:'M3 10 12 3l9 7v11h-6v-7H9v7H3z',
 orders:'M6 3h12v18H6z M9 7h6 M9 12h6 M9 17h4',
 messages:'M3 4h18v13H9l-6 4z',
 products:'m3 7 9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
 settings:'M10 2h4l.5 2.3 1.6.7 2-1.3 2.8 2.8-1.3 2 .7 1.6 2.3.5v4l-2.3.5-.7 1.6 1.3 2-2.8 2.8-2-1.3-1.6.7L14 22h-4l-.5-2.3-1.6-.7-2 1.3-2.8-2.8 1.3-2-.7-1.6L2 14v-4l2.3-.5.7-1.6-1.3-2 2.8-2.8 2 1.3 1.6-.7L10 2z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 preview:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
};
export function OwnerIcon({name}:{name:keyof typeof paths}){
 return <svg className="owner-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}
