import './theme.css';
import {RedesignDashboard} from './RedesignDashboard.js';
import {createRoot} from 'react-dom/client';
import './style.css';
import {prepareCatalogEntry} from './owner-startup.js';

prepareCatalogEntry();
createRoot(document.getElementById('root')!).render(<RedesignDashboard/>);
