import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state';
import { Shell } from './components/Shell';
import Library from './pages/Library';
import Search from './pages/Search';
import { MoviePage, ShowPage } from './pages/Movie';
import Catalog from './pages/Catalog';
import CatalogTitlePage from './pages/CatalogTitle';
import PersonPage, { PeoplePage, PersonFind } from './pages/Person';
import Player from './pages/Player';
import Torrents from './pages/Torrents';
import Lists from './pages/Lists';
import Devices from './pages/Devices';
import RemotePage from './pages/Remote';
import Settings from './pages/Settings';
import ProfilesPage from './pages/Profiles';
import { Login, Setup } from './pages/Setup';
import { tr } from './i18n';
import { WindowCaption } from './components/WindowControls';

function Gate() {
  const { state } = useApp();
  // Screens before the shell have no title bar: a bare caption keeps the
  // window movable and closable in the Windows app.
  if (!state) return <><WindowCaption /><div className="loading" style={{ minHeight: 'var(--vh)' }}><span className="spin lg" /></div></>;
  if (state.authRequired) return <><WindowCaption /><Login /></>;
  if (!state.setupDone && state.local) return <><WindowCaption /><Setup /></>;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Catalog />} />
        <Route path="library/:kind" element={<Library />} />
        <Route path="search" element={<Search />} />
        <Route path="catalog" element={<ToHome />} />
        <Route path="catalog/:kind/:id" element={<CatalogTitlePage />} />
        <Route path="person/find" element={<PersonFind />} />
        <Route path="person/:id" element={<PersonPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="movie/:id" element={<MoviePage />} />
        <Route path="show/:id" element={<ShowPage />} />
        <Route path="play/torrent/:hash" element={<Player />} />
        <Route path="play/:fileId" element={<Player />} />
        <Route path="lists" element={<Lists />} />
        <Route path="torrents" element={<Torrents />} />
        <Route path="devices" element={<Devices />} />
        <Route path="remote" element={<RemotePage />} />
        <Route path="remote/:id" element={<RemotePage />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profiles" element={<ProfilesPage />} />
        <Route path="*" element={<main className="main pad"><h1 className="h1">{tr('Страница не найдена', 'Page not found')}</h1></main>} />
      </Route>
    </Routes>
  );
}

// The catalog moved to Home; old /catalog links keep their filters.
function ToHome() {
  const { search } = useLocation();
  return <Navigate to={'/' + search} replace />;
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AppProvider>
  );
}
