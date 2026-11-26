import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, ScrollView, StyleSheet,
  Platform, StatusBar, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';

// ───────────────────────── رنگ‌ها ─────────────────────────
const C = {
  primary: '#1976D2',
  primaryDark: '#0D47A1',
  bg: '#FFFFFF',
  text: '#1B1F23',
  sub: '#6B7280',
  line: '#E5E7EB',
  danger: '#D32F2F',
};

// ───────────────────────── نقشه (Leaflet + OpenStreetMap) ─────────────────────────
// نقشه روی محدوده ایران قفل شده است.
const MAP_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
html,body,#map{height:100%;margin:0;background:#e8eef3}
.leaflet-control-attribution{font-size:9px}
.pin{width:26px;height:26px;background:#D32F2F;border:3px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.4)}
.me{width:18px;height:18px;background:#1976D2;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 6px rgba(25,118,210,.25)}
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var IRAN=[[24.0,43.0],[40.5,64.0]];
var map=L.map('map',{zoomControl:false,maxBounds:IRAN,maxBoundsViscosity:0.9,minZoom:5})
  .setView([32.4,53.7],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
var dest=null,me=null,line=null,pad=[40,40];
function send(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
map.on('click',function(e){send({type:'pick',lat:e.latlng.lat,lng:e.latlng.lng});});
window.setDest=function(lat,lng){
  if(dest)map.removeLayer(dest);
  dest=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="pin"></div>',iconSize:[26,26],iconAnchor:[13,26]})}).addTo(map);
};
window.clearDest=function(){if(dest){map.removeLayer(dest);dest=null;}};
window.setMe=function(lat,lng){
  if(me)map.removeLayer(me);
  me=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
};
window.flyTo=function(lat,lng,z){map.flyTo([lat,lng],z||15,{duration:0.8});};
window.drawRoute=function(coords,bottom,color){
  if(line)map.removeLayer(line);
  line=L.polyline(coords,{color:color||'#1976D2',weight:6,opacity:0.9}).addTo(map);
  map.fitBounds(line.getBounds(),{paddingTopLeft:[30,110],paddingBottomRight:[30,bottom||260]});
};
window.clearRoute=function(){if(line){map.removeLayer(line);line=null;}};
send({type:'ready'});
</script></body></html>`;

// ───────────────────────── ابزارها ─────────────────────────
const fa = (n) => Number(n).toLocaleString('fa-IR');

const fmtDist = (m) =>
  m < 1000 ? `${fa(Math.round(m / 10) * 10)} متر` : `${fa((m / 1000).toFixed(1))} کیلومتر`;

const fmtTime = (s) => {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${fa(min)} دقیقه`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${fa(h)} ساعت و ${fa(r)} دقیقه` : `${fa(h)} ساعت`;
};

const MOD = {
  left: 'به چپ بپیچید',
  'slight left': 'کمی به چپ بپیچید',
  'sharp left': 'تند به چپ بپیچید',
  right: 'به راست بپیچید',
  'slight right': 'کمی به راست بپیچید',
  'sharp right': 'تند به راست بپیچید',
  straight: 'مستقیم بروید',
  uturn: 'دور بزنید',
};

const stepText = (s) => {
  const m = s.maneuver || {};
  const road = s.name ? ` در ${s.name}` : '';
  if (m.type === 'depart') return `شروع مسیر${road}`;
  if (m.type === 'arrive') return 'به مقصد رسیدید';
  if (m.type === 'roundabout' || m.type === 'rotary')
    return `در میدان وارد شوید و از خروجی ${fa(m.exit || 1)} خارج شوید${road}`;
  return `${MOD[m.modifier] || 'ادامه دهید'}${road}`;
};

// ───────────── کامیون ─────────────
// وزن به تن، ابعاد به متر
const TRUCKS = [
  { name: 'سبک (وانت/کامیونت)', weight: 7.5, axle: 3.5, height: 2.8, width: 2.2, length: 7 },
  { name: 'متوسط (ده‌تن)', weight: 16, axle: 8, height: 3.5, width: 2.5, length: 9 },
  { name: 'سنگین (تک‌تریلی/تریلی)', weight: 40, axle: 10, height: 4, width: 2.5, length: 16.5 },
];
const CAR_COLOR = '#1976D2';
const TRUCK_COLOR = '#EF6C00';

const decodePoly = (str, prec = 6) => {
  let i = 0, lat = 0, lng = 0;
  const out = [];
  const f = Math.pow(10, prec);
  while (i < str.length) {
    let b, sh = 0, r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lat += r & 1 ? ~(r >> 1) : r >> 1;
    sh = 0; r = 0;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
    lng += r & 1 ? ~(r >> 1) : r >> 1;
    out.push([lat / f, lng / f]);
  }
  return out;
};

const VTYPE = {
  1: 'شروع مسیر', 2: 'شروع مسیر', 3: 'شروع مسیر',
  4: 'به مقصد رسیدید', 5: 'به مقصد رسیدید', 6: 'به مقصد رسیدید',
  8: 'ادامه دهید', 9: 'کمی به راست بپیچید', 10: 'به راست بپیچید', 11: 'تند به راست بپیچید',
  12: 'دور بزنید', 13: 'دور بزنید', 14: 'تند به چپ بپیچید', 15: 'به چپ بپیچید',
  16: 'کمی به چپ بپیچید', 17: 'وارد رمپ شوید', 18: 'از رمپ سمت راست بروید',
  19: 'از رمپ سمت چپ بروید', 20: 'از خروجی سمت راست خارج شوید',
  21: 'از خروجی سمت چپ خارج شوید', 22: 'مستقیم بروید', 23: 'سمت راست بمانید',
  24: 'سمت چپ بمانید', 25: 'ادغام شوید', 26: 'وارد میدان شوید', 27: 'از میدان خارج شوید',
};
const valhallaStepText = (m) => {
  const road = m.street_names && m.street_names.length ? ` در ${m.street_names[0]}` : '';
  return `${VTYPE[m.type] || 'ادامه دهید'}${road}`;
};

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'User-Agent': 'IranMapApp/1.0', 'Accept-Language': 'fa' };

// ───────────────────────── برنامه ─────────────────────────
export default function App() {
  const web = useRef(null);
  const ready = useRef(false);
  const timer = useRef(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [me, setMe] = useState(null);
  const [dest, setDest] = useState(null); // {lat,lng,name,address}
  const [route, setRoute] = useState(null); // {distance,duration,steps}
  const [routing, setRouting] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [vehicle, setVehicle] = useState('car'); // 'car' | 'truck'
  const [truckIdx, setTruckIdx] = useState(2);

  const run = useCallback((js) => web.current?.injectJavaScript(`${js};true;`), []);

  // موقعیت کاربر
  const locate = useCallback(async (fly = true) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('دسترسی به موقعیت', 'برای نمایش موقعیت شما، دسترسی مکان را فعال کنید.');
      return null;
    }
    const p = await Location.getCurrentPositionAsync({});
    const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
    setMe(pos);
    run(`setMe(${pos.lat},${pos.lng})`);
    if (fly) run(`flyTo(${pos.lat},${pos.lng},15)`);
    return pos;
  }, [run]);

  // جستجو (با تأخیر ۶۰۰ میلی‌ثانیه، طبق قوانین Nominatim)
  useEffect(() => {
    clearTimeout(timer.current);
    if (query.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(
          `${NOMINATIM}/search?format=jsonv2&countrycodes=ir&limit=8&accept-language=fa&q=${encodeURIComponent(query)}`,
          { headers: HEADERS }
        );
        setResults(await r.json());
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 600);
    return () => clearTimeout(timer.current);
  }, [query]);

  const clearRoute = () => {
    setRoute(null);
    setShowSteps(false);
    run('clearRoute()');
  };

  const selectPlace = (lat, lng, name, address) => {
    clearRoute();
    setDest({ lat, lng, name, address });
    run(`setDest(${lat},${lng});flyTo(${lat},${lng},16)`);
  };

  const pickResult = (item) => {
    Keyboard.dismiss();
    setResults([]);
    setQuery(item.name || item.display_name.split('،')[0]);
    selectPlace(
      parseFloat(item.lat), parseFloat(item.lon),
      item.name || item.display_name.split('،')[0],
      item.display_name
    );
  };

  // انتخاب نقطه با لمس نقشه
  const onPick = async (lat, lng) => {
    Keyboard.dismiss();
    setResults([]);
    selectPlace(lat, lng, 'در حال دریافت آدرس…', '');
    try {
      const r = await fetch(
        `${NOMINATIM}/reverse?format=jsonv2&accept-language=fa&lat=${lat}&lon=${lng}`,
        { headers: HEADERS }
      );
      const j = await r.json();
      if (j.address?.country_code && j.address.country_code !== 'ir') {
        setDest({ lat, lng, name: 'خارج از ایران', address: '' });
        return;
      }
      setDest({
        lat, lng,
        name: j.name || j.address?.road || 'نقطه انتخاب‌شده',
        address: j.display_name || '',
      });
    } catch {
      setDest({ lat, lng, name: 'نقطه انتخاب‌شده', address: '' });
    }
  };

  // مسیریابی (OSRM)
  const startRoute = async () => {
    if (!dest) return;
    setRouting(true);
    const from = me || (await locate(false));
    if (!from) { setRouting(false); return; }
    try {
      if (vehicle === 'truck') {
        // مسیریابی کامیون: پروفایل truck در Valhalla (ممنوعیت‌های کامیون، وزن و ابعاد)
        const t = TRUCKS[truckIdx];
        const res = await fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locations: [
              { lat: from.lat, lon: from.lng },
              { lat: dest.lat, lon: dest.lng },
            ],
            costing: 'truck',
            costing_options: {
              truck: {
                weight: t.weight, axle_load: t.axle,
                height: t.height, width: t.width, length: t.length,
              },
            },
            directions_options: { units: 'kilometers', language: 'en-US' },
          }),
        });
        const j = await res.json();
        if (!j.trip || j.trip.status !== 0) throw new Error('no truck route');
        const leg = j.trip.legs[0];
        const coords = decodePoly(leg.shape, 6);
        setRoute({
          distance: j.trip.summary.length * 1000,
          duration: j.trip.summary.time,
          steps: leg.maneuvers.map((m) => ({
            text: valhallaStepText(m),
            distance: m.length * 1000,
          })),
        });
        run(`drawRoute(${JSON.stringify(coords)},${showSteps ? 360 : 260},'${TRUCK_COLOR}')`);
      } else {
        const url =
          `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${dest.lng},${dest.lat}` +
          `?overview=full&geometries=geojson&steps=true`;
        const j = await (await fetch(url)).json();
        if (!j.routes?.length) throw new Error('no route');
        const r = j.routes[0];
        const coords = r.geometry.coordinates.map(([x, y]) => [y, x]);
        setRoute({
          distance: r.distance,
          duration: r.duration,
          steps: r.legs[0].steps.map((st) => ({ text: stepText(st), distance: st.distance })),
        });
        run(`drawRoute(${JSON.stringify(coords)},${showSteps ? 360 : 260},'${CAR_COLOR}')`);
      }
    } catch {
      Alert.alert(
        'مسیریابی',
        vehicle === 'truck'
          ? 'مسیر مجاز برای کامیون پیدا نشد. اتصال اینترنت یا ابعاد انتخاب‌شده را بررسی کنید.'
          : 'مسیری پیدا نشد. اتصال اینترنت را بررسی کنید.'
      );
    }
    setRouting(false);
  };

  // با تغییر نوع خودرو، اگر مسیر باز است دوباره مسیریابی می‌شود
  useEffect(() => {
    if (route) startRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle, truckIdx]);

  const closeAll = () => {
    clearRoute();
    setDest(null);
    setQuery('');
    run('clearDest()');
  };

  const onMessage = (e) => {
    const m = JSON.parse(e.nativeEvent.data);
    if (m.type === 'ready') {
      ready.current = true;
      locate(false);
    }
    if (m.type === 'pick') onPick(m.lat, m.lng);
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={web}
        originWhitelist={['*']}
        source={{ html: MAP_HTML }}
        onMessage={onMessage}
        javaScriptEnabled
        style={s.map}
      />

      {/* نوار جستجو */}
      <View style={s.top}>
        <View style={s.searchBox}>
          <TextInput
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="جستجو در نقشه ایران…"
            placeholderTextColor={C.sub}
            textAlign="right"
            returnKeyType="search"
          />
          {searching ? (
            <ActivityIndicator color={C.primary} />
          ) : query ? (
            <TouchableOpacity onPress={closeAll} hitSlop={10}>
              <Text style={s.clear}>✕</Text>
            </TouchableOpacity>
          ) : (
            <Text style={s.mag}>⌕</Text>
          )}
        </View>

        {results.length > 0 && (
          <FlatList
            style={s.list}
            keyboardShouldPersistTaps="handled"
            data={results}
            keyExtractor={(i) => String(i.place_id)}
            renderItem={({ item }) => (
              <TouchableOpacity style={s.row} onPress={() => pickResult(item)}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {item.name || item.display_name.split('،')[0]}
                </Text>
                <Text style={s.rowSub} numberOfLines={1}>{item.display_name}</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>

      {/* دکمه موقعیت من */}
      <TouchableOpacity
        style={[s.fab, { bottom: dest ? (route ? (showSteps ? 500 : 290) : 290) : 40 }]}
        onPress={() => locate(true)}
      >
        <Text style={s.fabIcon}>◎</Text>
      </TouchableOpacity>

      {/* کارت مقصد / مسیر */}
      {dest && (
        <View style={s.sheet}>
          <View style={s.grip} />
          <View style={s.seg}>
            {[['car', 'ماشین سواری'], ['truck', 'کامیون']].map(([k, label]) => (
              <TouchableOpacity
                key={k}
                style={[s.segItem, vehicle === k && s.segOn]}
                onPress={() => setVehicle(k)}
              >
                <Text style={[s.segText, vehicle === k && s.segTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {vehicle === 'truck' && (
            <View style={s.chips}>
              {TRUCKS.map((t, i) => (
                <TouchableOpacity
                  key={t.name}
                  style={[s.chip, truckIdx === i && s.chipOn]}
                  onPress={() => setTruckIdx(i)}
                >
                  <Text style={[s.chipText, truckIdx === i && s.chipTextOn]}>{t.name}</Text>
                </TouchableOpacity>
              ))}
              <Text style={s.truckInfo}>
                {`${fa(TRUCKS[truckIdx].weight)} تن • ارتفاع ${fa(TRUCKS[truckIdx].height)} متر • طول ${fa(TRUCKS[truckIdx].length)} متر`}
              </Text>
            </View>
          )}
          {!route ? (
            <>
              <Text style={s.title} numberOfLines={1}>{dest.name}</Text>
              {!!dest.address && <Text style={s.addr} numberOfLines={2}>{dest.address}</Text>}
              <TouchableOpacity style={s.btn} onPress={startRoute} disabled={routing}>
                {routing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={s.btnText}>مسیریابی</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={s.sumRow}>
                <Text style={s.time}>{fmtTime(route.duration)}</Text>
                <Text style={s.dist}>{fmtDist(route.distance)}</Text>
              </View>
              <Text style={s.addr} numberOfLines={1}>به {dest.name}</Text>
              <View style={s.btnRow}>
                <TouchableOpacity
                  style={[s.btn, s.btnGhost, { flex: 1 }]}
                  onPress={closeAll}
                >
                  <Text style={[s.btnText, { color: C.danger }]}>پایان</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btn, { flex: 2 }]}
                  onPress={() => setShowSteps((v) => !v)}
                >
                  <Text style={s.btnText}>{showSteps ? 'بستن مراحل' : 'مراحل مسیر'}</Text>
                </TouchableOpacity>
              </View>
              {showSteps && (
                <ScrollView style={s.steps}>
                  {route.steps.map((st, i) => (
                    <View key={i} style={s.step}>
                      <Text style={s.stepDist}>{st.distance ? fmtDist(st.distance) : ''}</Text>
                      <Text style={s.stepText}>{st.text}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ───────────────────────── استایل ─────────────────────────
const TOP = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 56;

const shadow = {
  shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 }, elevation: 6,
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  map: { flex: 1 },

  top: { position: 'absolute', top: TOP, left: 12, right: 12 },
  searchBox: {
    flexDirection: 'row-reverse', alignItems: 'center', backgroundColor: C.bg,
    borderRadius: 28, paddingHorizontal: 18, height: 52, ...shadow,
  },
  input: { flex: 1, fontSize: 16, color: C.text, writingDirection: 'rtl' },
  mag: { fontSize: 24, color: C.sub, marginLeft: 8 },
  clear: { fontSize: 18, color: C.sub, marginLeft: 8 },
  list: {
    backgroundColor: C.bg, borderRadius: 16, marginTop: 8, maxHeight: 320, ...shadow,
  },
  row: { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  rowTitle: { fontSize: 15, fontWeight: '700', color: C.text, textAlign: 'right' },
  rowSub: { fontSize: 12, color: C.sub, textAlign: 'right', marginTop: 2 },

  fab: {
    position: 'absolute', left: 14, width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  fabIcon: { fontSize: 26, color: C.primary },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18,
    paddingTop: 10, paddingBottom: 28, ...shadow,
  },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 12 },
  seg: {
    flexDirection: 'row-reverse', backgroundColor: '#F1F3F5', borderRadius: 12,
    padding: 3, marginBottom: 12,
  },
  segItem: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.bg, ...shadow, elevation: 2, shadowOpacity: 0.1 },
  segText: { fontSize: 14, color: C.sub, fontWeight: '600' },
  segTextOn: { color: C.text },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: C.line,
  },
  chipOn: { backgroundColor: '#FFF3E0', borderColor: TRUCK_COLOR },
  chipText: { fontSize: 12, color: C.sub },
  chipTextOn: { color: '#E65100', fontWeight: '700' },
  truckInfo: { width: '100%', fontSize: 12, color: C.sub, textAlign: 'right', marginTop: 2 },
  title: { fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'right' },
  addr: { fontSize: 13, color: C.sub, textAlign: 'right', marginTop: 4, marginBottom: 14 },

  btn: {
    backgroundColor: C.primary, borderRadius: 14, height: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhost: { backgroundColor: '#FDECEA' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnRow: { flexDirection: 'row-reverse', gap: 10 },

  sumRow: { flexDirection: 'row-reverse', alignItems: 'baseline', gap: 12 },
  time: { fontSize: 24, fontWeight: '800', color: C.primaryDark },
  dist: { fontSize: 15, color: C.sub },

  steps: { maxHeight: 200, marginTop: 14 },
  step: {
    flexDirection: 'row-reverse', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  stepText: { flex: 1, fontSize: 14, color: C.text, textAlign: 'right' },
  stepDist: { fontSize: 12, color: C.sub, marginLeft: 10, alignSelf: 'center' },
});
