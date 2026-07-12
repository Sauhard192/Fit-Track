import { Decoder, Stream } from "@garmin/fitsdk";

function iso(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function pacePer100(seconds, distance) {
  return seconds && distance ? seconds * 100 / distance : null;
}

function distanceBucket(distance) {
  if (distance <= 0) return "Rest";
  if (distance <= 25) return "25m";
  if (distance <= 50) return "50m";
  if (distance <= 100) return "100m";
  if (distance <= 200) return "200m";
  if (distance <= 400) return "400m";
  return "400m+";
}

function zoneFor(heartRate, zones) {
  return zones.find((zone) => heartRate >= zone.min && heartRate <= zone.max)?.id || zones.at(-1)?.id;
}

function zoneDistribution(records, zones) {
  const totals = Object.fromEntries(zones.map((zone) => [zone.id, 0]));
  for (let index = 0; index < records.length - 1; index += 1) {
    const current = records[index];
    const next = records[index + 1];
    if (!Number.isFinite(current.heartRate) || !current.timestamp || !next.timestamp) continue;
    const zone = zoneFor(current.heartRate, zones);
    const duration = Math.max(0, (new Date(next.timestamp) - new Date(current.timestamp)) / 1000);
    if (zone) totals[zone] += duration;
  }
  return Object.fromEntries(Object.entries(totals).map(([zone, seconds]) => [zone, Math.round(seconds * 10) / 10]));
}

export async function parseFitActivity(file, zones) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error("This is not a valid FIT file.");
  const { messages, errors } = decoder.read();
  if (errors.length && !messages.sessionMesgs?.length) throw new Error(errors[0]);

  const session = messages.sessionMesgs?.[0];
  if (!session || session.sport !== "swimming" || session.subSport !== "lapSwimming") {
    throw new Error("This FIT file does not contain a supported pool-swim activity.");
  }

  const fileStem = file.name.replace(/\.fit$/i, "");
  const sessionStart = iso(session.startTime);
  const date = sessionStart.slice(0, 10);
  const laps = [];
  const drills = [];
  const rests = [];

  (messages.lapMesgs || []).forEach((row, index) => {
    const distance = row.totalDistance || 0;
    const stroke = row.swimStroke || "rest";
    const timer = row.totalTimerTime || 0;
    const type = distance <= 0 ? "rest" : stroke === "drill" ? "drill" : "normal";
    const lap = {
      id: `${fileStem}-${row.messageIndex ?? index}`,
      file: file.name,
      date,
      startTime: iso(row.startTime),
      endTime: iso(row.timestamp),
      distance,
      bucket: distanceBucket(distance),
      stroke,
      type,
      timerSeconds: timer,
      elapsedSeconds: row.totalElapsedTime || timer,
      pace100: pacePer100(timer, distance),
      avgHr: row.avgHeartRate ?? null,
      maxHr: row.maxHeartRate ?? null,
      minHr: row.minHeartRate ?? null,
      strokes: row.totalStrokes ?? row.totalCycles ?? 0,
      cadence: row.avgCadence || 0,
      lengths: row.numLengths || 0,
      activeLengths: row.numActiveLengths || 0,
    };
    if (type === "normal") laps.push(lap);
    else if (type === "drill") drills.push(lap);
    else rests.push(lap);
  });

  const records = messages.recordMesgs || [];
  const heartRates = records.map((record) => record.heartRate).filter(Number.isFinite);
  const normalDistance = laps.reduce((sum, lap) => sum + lap.distance, 0);
  const normalTimerSeconds = laps.reduce((sum, lap) => sum + lap.timerSeconds, 0);
  const drillDistance = drills.reduce((sum, lap) => sum + lap.distance, 0);
  const drillTimerSeconds = drills.reduce((sum, lap) => sum + lap.timerSeconds, 0);

  return {
    id: fileStem,
    file: file.name,
    date,
    startTime: sessionStart,
    poolLength: session.poolLength ?? null,
    totalDistance: session.totalDistance || 0,
    normalDistance,
    normalTimerSeconds,
    normalEffortCount: laps.length,
    normalPace100: pacePer100(normalTimerSeconds, normalDistance),
    drillDistance,
    drillTimerSeconds,
    drillEffortCount: drills.length,
    drillPace100: pacePer100(drillTimerSeconds, drillDistance),
    timerSeconds: session.totalTimerTime || 0,
    elapsedSeconds: session.totalElapsedTime || 0,
    avgHr: session.avgHeartRate ?? null,
    maxHr: session.maxHeartRate ?? null,
    minHr: session.minHeartRate ?? null,
    avgCadence: session.avgCadence ?? null,
    maxCadence: session.maxCadence ?? null,
    calories: session.totalCalories ?? null,
    recordHr: {
      count: heartRates.length,
      min: heartRates.length ? Math.min(...heartRates) : null,
      avg: heartRates.length ? Math.round((heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length) * 10) / 10 : null,
      max: heartRates.length ? Math.max(...heartRates) : null,
    },
    hrZones: zoneDistribution(records, zones),
    laps,
    drills,
    rests,
  };
}
