// Daily navigation keeps a work area's place. Task shortcuts deliberately open
// a clean worklist so a previous search or product cannot hide the new task.
export const catalogTaskRoute:Record<string,string|null>={view:'catalog',inventory:'1',bulk:null,quick:null,product:null,q:null,visibility:null,stock:null,family:null,brand:null,exception:null,sort:null,cursor:null,page:null};
export const orderTaskRoute:Record<string,string|null>={view:'requests',requests:'review',order:null,orderSearch:null,orderPage:null};
export const inboxTaskRoute:Record<string,string|null>={view:'conversations',conversation:null,inboxHelp:null,inboxSearch:null,inboxPage:null};
