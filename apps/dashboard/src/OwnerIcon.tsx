const paths={
 plus:'M12 5v14 M5 12h14',
 back:'m12 5-7 7 7 7 M5 12h14',
 right:'m9 6 6 6-6 6',
 send:'m22 2-7 20-4-9-9-4 20-7Z M22 2 11 13',
 globe:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z M2 12h20 M12 2c5 5 5 15 0 20-5-5-5-15 0-20Z',
 signOut:'M10 17l5-5-5-5 M15 12H3 M15 3h5v18h-5',
 check:'m5 12 4 4L19 6',
 chevron:'m6 9 6 6 6-6',
 more:'M5 12h.01 M12 12h.01 M19 12h.01',
 download:'M12 3v12m-4-4 4 4 4-4 M5 16v4h14v-4',
 print:'M7 8V4h10v4m-10 9H4v-8h16v8h-3m-10-3h10v6H7z',
 history:'M4 11a8 8 0 1 1 2 6m-2-6V6m0 5h5m3-4v5l3 2',
 remove:'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
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
