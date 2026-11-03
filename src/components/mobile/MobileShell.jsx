import React, { useState } from 'react';
import MobileHeader from './MobileHeader.jsx';
import MobileSearch from './MobileSearch.jsx';
import MobileRouteCard from './MobileRouteCard.jsx';
import MobileRouteSheet from './MobileRouteSheet.jsx';
import MobileTabs from './MobileTabs.jsx';
import HospitalSearch from '../hospital/HospitalSearch.jsx';
import DoctorsPanel from '../hospital/DoctorsPanel.jsx';
const ParkingPanel = () => null;
const PromoSlider = () => null;
const isParking = () => false;
import './mobile.css';

// Phone layout. Navigation state lives in App.jsx (shared with desktop);
// this owns only which picker is open. Bottom tabs: Map / Search / Offers / Rewards. The home sheet shows
// only the promotion slider, and never pops over an active navigation.
export default function MobileShell(props) {
  const {
    model, scene, sceneRef, floorTitle, theme, setTheme, viewMode, setViewMode, colourMode, setColourMode,
    places, onSelectDestination, onSelectStart, startPlace, destPlace, onSwap, clearRoute,
    transportPref, setTransportPref, plan, totalDist, onStartNavigation, navigating, onExitNavigation,
    tab, setTab, sheet, navCard, arrival, demo, setHighlightType, savedCar, onReturnToVehicle, onNearest,
    roaming, roamBar,
  } = props;
  const [picker, setPicker] = useState(null);   // 'start' | 'dest' | null
  const onMap = tab === 'map' || tab === 'parking';
  const onDeck = isParking(props.floor);
  const showParking = tab === 'parking' || (tab === 'map' && onDeck && !sheet && !navigating && !destPlace && !props.arrival && !!props.parking?.selectedSlot);
  const showAds = tab === 'map' && ((navigating && !sheet && !arrival) || (onDeck && !showParking && !sheet && !destPlace && !arrival)) && model.promotions.length > 0;

  return (
    <div className={'mShell' + (navigating ? ' navigating' : '')}>
      <MobileHeader title={model.settings?.hospital_name} theme={theme} setTheme={setTheme} navigating={navigating} destName={destPlace?.name} onExitNavigation={onExitNavigation}
        colourMode={colourMode} setColourMode={setColourMode} demo={demo} navControls={props.navHeaderCtl} />

      <div className="mMapArea">
        {scene}
        {onMap && !navigating && tab === 'map' && !props.hunting && (
          <MobileRouteCard startPlace={startPlace} destPlace={destPlace} onSwap={onSwap} onClearDest={clearRoute}
            onEditStart={() => setPicker('start')} onEditDest={() => setPicker('dest')} />
        )}
        {onMap && <div className={'mFloorTitle' + (tab === 'map' && !navigating ? '' : ' high')}>{floorTitle}</div>}
        {props.qrNote}
        {tab === 'map' && roamBar}

        {(tab === 'search' || tab === 'doctors') && (
          <div className="mPanel" role="region" aria-label={tab === 'search' ? 'Search' : 'Doctors'}>
            {tab === 'search'
              ? <HospitalSearch key={props.searchQuery} initialQuery={props.searchQuery} model={model} autoFocus={false} onRoom={(u) => props.openStore(u)} onDirections={onSelectDestination} onNearest={onNearest} />
              : <DoctorsPanel model={model} onRoom={(u) => props.openStore(u)} onDirections={onSelectDestination} />}
          </div>
        )}
      </div>

      {showParking && (
        <div className="mSheet mParkingSheet" role="region" aria-label="Parking">
          <ParkingPanel model={model} floor={props.floor} {...props.parking} />
        </div>
      )}

      {tab === 'map' && !sheet && !navigating && destPlace && (
        <MobileRouteSheet destPlace={destPlace} plan={plan} totalDist={totalDist}
          transportPref={transportPref} onChangeTravelMode={setTransportPref} onStart={onStartNavigation} />
      )}
      {tab === 'map' && !sheet && navCard}
      {showAds && (
        <div className="mNavAd" aria-label="Sponsored">
          <PromoSlider promotions={model.promotions} onPromotion={props.openPromotion} onPromoView={props.onPromoView} />
        </div>
      )}
      {tab === 'map' && arrival}

      {sheet}

      {picker && (
        <MobileSearch mode={picker === 'start' ? 'start' : 'destination'} places={places} model={model}
          savedCar={savedCar} onReturnToVehicle={() => { setPicker(null); onReturnToVehicle(); }}
          onNearest={(kind) => { setPicker(null); onNearest(kind); }}
          onClose={() => setPicker(null)} onHighlightFacility={setHighlightType}
          onSelect={(id) => { (picker === 'start' ? onSelectStart : onSelectDestination)(id); setPicker(null); }} />
      )}

      {!navigating && <MobileTabs tab={tab} setTab={setTab} />}
    </div>
  );
}
