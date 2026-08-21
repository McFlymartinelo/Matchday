/** Zones UEFA / relégation à partir du payload BSD (`zone` + légende `zones`). */

export function zoneBucket(zoneKey, zoneLabel = '') {
  const key = String(zoneKey ?? '').toLowerCase();
  const label = String(zoneLabel ?? '').toLowerCase();
  if (key === 'cl' || key === 'clq' || key === 'ucl' || label.includes('champions')) return 'cl';
  if (key === 'el' || key === 'elq' || key === 'uel' || (label.includes('europa') && !label.includes('conference'))) return 'el';
  if (key === 'uecl' || key === 'ecl' || key === 'coe' || label.includes('conference') || label.includes('conférence')) return 'ecl';
  if (key === 'relq' || (label.includes('playoff') && label.includes('releg'))) return 'relq';
  if (key === 'rel' || label.includes('relegation') || label.includes('relégation')) return 'rel';
  return null;
}

export function extractZonesLegend(zones) {
  if (!zones) return [];
  if (Array.isArray(zones)) {
    return zones.filter(z => z && Number(z.from) >= 1 && Number(z.to) >= Number(z.from));
  }
  if (typeof zones === 'object') {
    return Object.values(zones).flat().filter(z => z && Number(z.from) >= 1);
  }
  return [];
}

export function applyZonesToRows(rows, zonesLegend) {
  const legend = extractZonesLegend(zonesLegend);
  return rows.map(row => {
    let zoneKey = row.zone_key ?? row.zone?.key ?? null;
    let zoneLabel = row.zone_label ?? row.zone?.label ?? null;
    let zoneType = row.zone_type ?? row.zone?.type ?? null;
    if (!zoneKey && legend.length && row.position) {
      const z = legend.find(item => row.position >= item.from && row.position <= item.to);
      if (z) {
        zoneKey = z.key ?? null;
        zoneLabel = z.label ?? zoneLabel;
        zoneType = z.type ?? zoneType;
      }
    }
    return {
      ...row,
      zone_key: zoneKey,
      zone_label: zoneLabel,
      zone_type: zoneType,
    };
  });
}

/** Fallback si BSD n’envoie pas encore de légende (début de saison / table calculée). */
export function defaultEuropeanZones(compCode, tableSize) {
  const n = Number(tableSize) || 20;
  const code = String(compCode ?? '').toUpperCase();

  if (code === 'L1') {
    return [
      { key: 'cl', label: 'Champions League', type: 'qualification', from: 1, to: 3 },
      { key: 'clq', label: 'Champions League Qualification', type: 'qualification', from: 4, to: 4 },
      { key: 'el', label: 'Europa League', type: 'qualification', from: 5, to: 5 },
      { key: 'uecl', label: 'Conference League Qualification', type: 'qualification', from: 6, to: 6 },
      { key: 'relq', label: 'Relegation Playoffs', type: 'relegation', from: Math.max(n - 2, 1), to: Math.max(n - 2, 1) },
      { key: 'rel', label: 'Relegation', type: 'relegation', from: Math.max(n - 1, 1), to: n },
    ];
  }

  if (code === 'BL1' || n === 18) {
    return [
      { key: 'cl', label: 'Champions League', type: 'qualification', from: 1, to: 4 },
      { key: 'el', label: 'Europa League', type: 'qualification', from: 5, to: 5 },
      { key: 'uecl', label: 'Conference League Qualification', type: 'qualification', from: 6, to: 6 },
      { key: 'relq', label: 'Relegation Playoffs', type: 'relegation', from: Math.max(n - 2, 1), to: Math.max(n - 2, 1) },
      { key: 'rel', label: 'Relegation', type: 'relegation', from: Math.max(n - 1, 1), to: n },
    ];
  }

  return [
    { key: 'cl', label: 'Champions League', type: 'qualification', from: 1, to: 4 },
    { key: 'el', label: 'Europa League', type: 'qualification', from: 5, to: 5 },
    { key: 'uecl', label: 'Conference League Qualification', type: 'qualification', from: 6, to: 6 },
    { key: 'rel', label: 'Relegation', type: 'relegation', from: Math.max(n - 2, 1), to: n },
  ];
}
