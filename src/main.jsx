import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { hexbin as createHexbin } from "d3-hexbin";
import { linearRegression, linearRegressionLine, standardDeviation } from "simple-statistics";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleAlert,
  Files,
  HeartPulse,
  Repeat2,
  RotateCcw,
  Timer,
  Trash2,
  Upload,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import "./styles.css";

const shortFilters = [25, 50, 100, 200, 400];
const filesPerPage = 14;
const dayMs = 24 * 60 * 60 * 1000;
const timeRanges = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "14d", label: "Last 2 weeks", days: 14 },
  { value: "21d", label: "Last 3 weeks", days: 21 },
  { value: "30d", label: "Last month", days: 30 },
  { value: "custom", label: "Custom range" },
];

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function formatPace(seconds) {
  return seconds ? `${formatTime(seconds)}/100m` : "-";
}

function formatDistance(meters) {
  if (!Number.isFinite(meters)) return "-";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function shortDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function monthLabel(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function titleCase(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function formatLongDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function flatten(data, key) {
  return data.sessions.flatMap((session) =>
    session[key].map((lap) => ({
      ...lap,
      sessionId: session.id,
      poolLength: session.poolLength,
    }))
  );
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function weightedPace(laps) {
  const totals = laps.reduce(
    (sum, lap) => ({
      distance: sum.distance + (lap.distance || 0),
      seconds: sum.seconds + (lap.timerSeconds || 0),
    }),
    { distance: 0, seconds: 0 }
  );
  return totals.distance > 0 ? (totals.seconds * 100) / totals.distance : null;
}

function bestPace(laps) {
  const paces = laps.map((lap) => lap.pace100).filter((pace) => Number.isFinite(pace));
  return paces.length ? Math.min(...paces) : null;
}

function strokesPerLength(lap) {
  const lengthCount = lap.activeLengths || (
    lap.poolLength && lap.distance ? lap.distance / lap.poolLength : 0
  );
  if (!lap.strokes || !lengthCount) return "-";
  const value = lap.strokes / lengthCount;
  return Number.isInteger(value) ? value : value.toFixed(1);
}

function hardShare(session) {
  const zones = session.hrZones || {};
  const total = Object.values(zones).reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  return ((zones.z4 || 0) + (zones.z5 || 0)) / total;
}

function markPersonalRecords(laps, separateStrokes) {
  const bestByType = new Map();
  return laps
    .map((lap, index) => ({ ...lap, _sequence: index }))
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a._sequence - b._sequence)
    .map((lap) => {
      const key = separateStrokes ? `${lap.distance}-${lap.stroke}` : `${lap.distance}`;
      const previousBest = bestByType.get(key);
      const isPr = Number.isFinite(lap.pace100) && (previousBest === undefined || lap.pace100 < previousBest);
      if (isPr) bestByType.set(key, lap.pace100);
      return { ...lap, isPr };
    })
    .sort((a, b) => a._sequence - b._sequence)
    .map(({ _sequence, ...lap }) => lap);
}

function filterByTimeRange(laps, range, customStart, customEnd, anchorDate) {
  if (range === "all" || !anchorDate) return laps;
  let start = null;
  let end = null;

  if (range === "custom") {
    start = customStart ? new Date(`${customStart}T00:00:00`).getTime() : null;
    end = customEnd ? new Date(`${customEnd}T23:59:59`).getTime() : null;
  } else {
    const option = timeRanges.find((item) => item.value === range);
    const anchorStart = new Date(`${anchorDate}T00:00:00`).getTime();
    end = new Date(`${anchorDate}T23:59:59`).getTime();
    start = anchorStart - ((option?.days || 1) - 1) * dayMs;
  }

  return laps.filter((lap) => {
    const time = new Date(`${lap.date}T12:00:00`).getTime();
    return (start === null || time >= start) && (end === null || time <= end);
  });
}

function Metric({ label, value, detail, icon: Icon }) {
  return (
    <div className="metric">
      <div className="metricTop">
        <div className="metricLabel">{label}</div>
        {Icon && <Icon className="metricIcon" aria-hidden="true" />}
      </div>
      <div className="metricValue">{value}</div>
      {detail && <div className="metricDetail">{detail}</div>}
    </div>
  );
}

function Segmented({ value, options, onChange, format = (item) => item }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          className={option === value ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}

function StrokeTabs({ value, options, onChange }) {
  return (
    <div className="tabs">
      {options.map((option) => (
        <button
          key={option}
          className={option === value ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function LongerMenu({ value, distances, onChange }) {
  const [open, setOpen] = useState(false);
  const isLong = typeof value === "number" && value > 400;
  const label = isLong ? `${value}m` : "Longer";

  return (
    <div className="menuWrap">
      <button
        className={isLong ? "menuButton active" : "menuButton"}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="menuButtonLabel">{label}</span>
        <ChevronDown className="chevronIcon" aria-hidden="true" />
      </button>
      {open && (
        <div className="menuList">
          {distances.map((distance) => (
            <button
              key={distance}
              className={distance === value ? "active" : ""}
              onClick={() => {
                onChange(distance);
                setOpen(false);
              }}
            >
              {distance}m
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DistanceDropdown({ value, distances, onChange, allowAll = true }) {
  const [open, setOpen] = useState(false);
  const label = value === "All" ? "All distances" : `${value}m`;

  return (
    <div className="menuWrap">
      <button className="menuButton active singleDropdown" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="menuButtonLabel">{label}</span>
        <ChevronDown className="chevronIcon" aria-hidden="true" />
      </button>
      {open && (
        <div className="menuList">
          {allowAll && (
            <button
              className={value === "All" ? "active" : ""}
              onClick={() => {
                onChange("All");
                setOpen(false);
              }}
            >
              All distances
            </button>
          )}
          {distances.map((distance) => (
            <button
              key={distance}
              className={distance === value ? "active" : ""}
              onClick={() => {
                onChange(distance);
                setOpen(false);
              }}
            >
              {distance}m
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeRangeMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = timeRanges.find((option) => option.value === value) || timeRanges[0];

  return (
    <div className="menuWrap timeRangeMenu">
      <button
        type="button"
        className="menuButton"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="menuButtonLabel">{selected.label}</span>
        <ChevronDown className="chevronIcon" aria-hidden="true" />
      </button>
      {open && (
        <div className="menuList">
          {timeRanges.map((option) => (
            <button
              type="button"
              key={option.value}
              className={option.value === value ? "active" : ""}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PoolLengthMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const options = ["All", 25, 50];
  const label = value === "All" ? "All pools" : `${value}m pool`;

  return (
    <div className="menuWrap poolLengthMenu">
      <button
        type="button"
        className="menuButton"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="menuButtonLabel">{label}</span>
        <ChevronDown className="chevronIcon" aria-hidden="true" />
      </button>
      {open && (
        <div className="menuList">
          {options.map((option) => (
            <button
              type="button"
              key={option}
              className={option === value ? "active" : ""}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option === "All" ? "All pools" : `${option}m pool`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getTicks(points, minTime, maxTime) {
  if (!points.length) return [];
  const months = [];
  const seen = new Set();
  points.forEach((point) => {
    const date = new Date(point.time);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!seen.has(key)) {
      seen.add(key);
      months.push({ label: monthLabel(point.time), time: point.time });
    }
  });
  if (months.length <= 6) return months;
  const step = Math.ceil(months.length / 6);
  const sampled = months.filter((_, index) => index % step === 0);
  const last = months[months.length - 1];
  if (sampled[sampled.length - 1].label !== last.label) sampled.push(last);
  return sampled.filter((tick) => tick.time >= minTime && tick.time <= maxTime);
}

function PaceTrend({ laps }) {
  const [domain, setDomain] = useState(null);
  const [drag, setDrag] = useState(null);
  const [scrubDrag, setScrubDrag] = useState(null);
  const [hovered, setHovered] = useState(null);
  const chartRef = useRef(null);
  const interactionRef = useRef(null);
  const gestureScaleRef = useRef(1);
  const width = 920;
  const height = 340;
  const pad = { left: 54, right: 24, top: 28, bottom: 44 };
  const points = laps
    .filter((lap) => lap.pace100 && lap.distance > 0)
    .map((lap) => ({ ...lap, time: new Date(lap.date).getTime() }))
    .sort((a, b) => a.time - b.time);
  const hasPoints = points.length > 0;

  useEffect(() => {
    setDomain(null);
    setHovered(null);
  }, [laps]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !hasPoints) return undefined;

    const handleWheel = (event) => interactionRef.current?.wheel(event);
    const handleGestureStart = (event) => {
      event.preventDefault();
      event.stopPropagation();
      gestureScaleRef.current = 1;
    };
    const handleGestureChange = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const previousScale = gestureScaleRef.current;
      gestureScaleRef.current = event.scale;
      interactionRef.current?.pinch(previousScale / Math.max(0.01, event.scale), event.clientX);
    };
    const handleGestureEnd = (event) => {
      event.preventDefault();
      event.stopPropagation();
      gestureScaleRef.current = 1;
    };

    chart.addEventListener("wheel", handleWheel, { passive: false });
    chart.addEventListener("gesturestart", handleGestureStart, { passive: false });
    chart.addEventListener("gesturechange", handleGestureChange, { passive: false });
    chart.addEventListener("gestureend", handleGestureEnd, { passive: false });
    return () => {
      chart.removeEventListener("wheel", handleWheel);
      chart.removeEventListener("gesturestart", handleGestureStart);
      chart.removeEventListener("gesturechange", handleGestureChange);
      chart.removeEventListener("gestureend", handleGestureEnd);
    };
  }, [hasPoints]);

  if (!hasPoints) return <div className="emptyChart">No matching efforts in this time range.</div>;

  const fullMinTime = Math.min(...points.map((point) => point.time));
  const fullMaxTime = Math.max(...points.map((point) => point.time));
  const viewDomain = domain || [fullMinTime, fullMaxTime];
  const [minTime, maxTime] = viewDomain;
  const visiblePoints = points.filter((point) => point.time >= minTime && point.time <= maxTime);
  const plotPoints = visiblePoints.length ? visiblePoints : points;
  const minPace = Math.min(...plotPoints.map((point) => point.pace100));
  const maxPace = Math.max(...plotPoints.map((point) => point.pace100));
  const x = (time) =>
    pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * (width - pad.left - pad.right);
  const y = (pace) =>
    pad.top + ((pace - minPace) / Math.max(1, maxPace - minPace)) * (height - pad.top - pad.bottom);

  const dateGroups = [...new Map(plotPoints.map((point) => [point.date, point])).keys()].map((date) => {
    const dayPoints = plotPoints.filter((point) => point.date === date);
    return {
      date,
      time: new Date(date).getTime(),
      pace: weightedPace(dayPoints),
    };
  });
  const trendPath = dateGroups.map((item, index) => `${index ? "L" : "M"} ${x(item.time)} ${y(item.pace)}`).join(" ");
  const ticks = getTicks(plotPoints, minTime, maxTime);
  const tooltipX = hovered ? x(hovered.time) : 0;
  const tooltipY = hovered ? y(hovered.pace100) : 0;
  const tooltipWidth = 220;
  const tooltipHeight = 194;
  const tooltipLeft = Math.max(8, Math.min(width - tooltipWidth - 8, tooltipX > width - 260 ? tooltipX - tooltipWidth - 14 : tooltipX + 14));
  const preferredTop = tooltipY + tooltipHeight + 16 < height - pad.bottom
    ? tooltipY + 14
    : tooltipY - tooltipHeight - 14;
  const tooltipTop = Math.max(8, Math.min(height - tooltipHeight - 8, preferredTop));
  const canReset = domain && (domain[0] !== fullMinTime || domain[1] !== fullMaxTime);
  const fullSpan = Math.max(1, fullMaxTime - fullMinTime);
  const viewSpan = Math.max(1, maxTime - minTime);
  const thumbLeft = ((minTime - fullMinTime) / fullSpan) * 100;
  const thumbWidth = Math.max(6, (viewSpan / fullSpan) * 100);

  const zoomAround = (factor, anchor = minTime + (maxTime - minTime) / 2) => {
    const span = maxTime - minTime;
    const nextSpan = Math.max(
      Math.min(fullSpan, 24 * 60 * 60 * 1000),
      Math.min(fullSpan, span * factor)
    );
    const anchorRatio = (anchor - minTime) / Math.max(1, span);
    let nextMin = anchor - nextSpan * anchorRatio;
    let nextMax = nextMin + nextSpan;
    if (nextMin < fullMinTime) {
      nextMin = fullMinTime;
      nextMax = nextMin + nextSpan;
    }
    if (nextMax > fullMaxTime) {
      nextMax = fullMaxTime;
      nextMin = nextMax - nextSpan;
    }
    setDomain(nextSpan >= fullSpan * 0.999 ? null : [nextMin, nextMax]);
  };

  const startPan = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ startX: event.clientX, domain: [minTime, maxTime], rectWidth: rect.width });
  };

  const pan = (event) => {
    if (!drag) return;
    const span = drag.domain[1] - drag.domain[0];
    const deltaPx = event.clientX - drag.startX;
    const deltaTime = (deltaPx / Math.max(1, drag.rectWidth)) * span;
    let nextMin = drag.domain[0] - deltaTime;
    let nextMax = drag.domain[1] - deltaTime;
    if (nextMin < fullMinTime) {
      nextMin = fullMinTime;
      nextMax = nextMin + span;
    }
    if (nextMax > fullMaxTime) {
      nextMax = fullMaxTime;
      nextMin = nextMax - span;
    }
    setDomain([nextMin, nextMax]);
  };

  const scrollPan = (event) => {
    const span = maxTime - minTime;
    const primaryDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const deltaTime = (primaryDelta / 420) * span;
    let nextMin = minTime + deltaTime;
    let nextMax = maxTime + deltaTime;
    if (nextMin < fullMinTime) {
      nextMin = fullMinTime;
      nextMax = nextMin + span;
    }
    if (nextMax > fullMaxTime) {
      nextMax = fullMaxTime;
      nextMin = nextMax - span;
    }
    setDomain(nextMax - nextMin >= fullSpan * 0.999 ? null : [nextMin, nextMax]);
  };

  const timeAtClientX = (clientX) => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return minTime + viewSpan / 2;
    const localX = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const svgX = (localX / Math.max(1, rect.width)) * width;
    const ratio = Math.min(1, Math.max(0, (svgX - pad.left) / (width - pad.left - pad.right)));
    return minTime + ratio * viewSpan;
  };

  const scrubAt = (clientX, rect, dragState = null) => {
    const local = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const ratio = local / Math.max(1, rect.width);
    const span = dragState?.span || viewSpan;
    let nextMin = fullMinTime + ratio * fullSpan - (dragState?.offset || span / 2);
    let nextMax = nextMin + span;
    if (nextMin < fullMinTime) {
      nextMin = fullMinTime;
      nextMax = nextMin + span;
    }
    if (nextMax > fullMaxTime) {
      nextMax = fullMaxTime;
      nextMin = nextMax - span;
    }
    setDomain([nextMin, nextMax]);
  };

  const startScrub = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    const local = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    const pointerTime = fullMinTime + (local / Math.max(1, rect.width)) * fullSpan;
    const state = {
      rect,
      span: viewSpan,
      offset: Math.min(viewSpan, Math.max(0, pointerTime - minTime)),
    };
    setScrubDrag(state);
    scrubAt(event.clientX, rect, state);
  };

  const moveScrub = (event) => {
    if (!scrubDrag) return;
    scrubAt(event.clientX, scrubDrag.rect, scrubDrag);
  };

  interactionRef.current = {
    wheel: (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        zoomAround(Math.exp(event.deltaY * 0.008), timeAtClientX(event.clientX));
      } else {
        scrollPan(event);
      }
    },
    pinch: (factor, clientX) => zoomAround(factor, timeAtClientX(clientX)),
  };

  const latestPrByDistance = new Map();
  points.filter((point) => point.isPr).forEach((point) => latestPrByDistance.set(point.distance, point.id));
  const latestPrIds = new Set(latestPrByDistance.values());

  return (
    <div className="chartWrap">
      <div className="chartTools">
        <span className="chartCount">
          {plotPoints.filter((point) => point.isPr).length} PRs · {plotPoints.length} efforts
        </span>
        <div className="chartZoomControls" aria-label="Chart zoom controls">
          <button
            type="button"
            className="chartIconButton"
            onClick={() => zoomAround(1.55)}
            disabled={!canReset}
            aria-label="Zoom out"
            data-tooltip="Zoom out"
          >
            <ZoomOut aria-hidden="true" />
          </button>
          <button
            type="button"
            className="chartIconButton"
            onClick={() => setDomain(null)}
            disabled={!canReset}
            aria-label="Reset chart view"
            data-tooltip="Reset view"
          >
            <RotateCcw aria-hidden="true" />
          </button>
          <button
            type="button"
            className="chartIconButton"
            onClick={() => zoomAround(0.64)}
            aria-label="Zoom in"
            data-tooltip="Zoom in"
          >
            <ZoomIn aria-hidden="true" />
          </button>
        </div>
      </div>
      <svg
        ref={chartRef}
        className="chart interactiveChart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Swim pace over time. Drag or scroll to pan and pinch to zoom."
        onPointerDown={startPan}
        onPointerMove={pan}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => {
          setDrag(null);
          setHovered(null);
        }}
        onDoubleClick={() => setDomain(null)}
      >
        <title>Swim pace over time</title>
        <desc>All matching efforts are shown. Only points that set a new personal record are interactive.</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const yy = pad.top + tick * (height - pad.top - pad.bottom);
          const pace = minPace + tick * (maxPace - minPace);
          return (
            <g key={tick}>
              <line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="grid" />
              <text x={12} y={yy + 4} className="axisLabel">
                {formatTime(pace)}
              </text>
            </g>
          );
        })}
        <path d={trendPath} className="trendLine" />
        {hovered && <line x1={tooltipX} y1={pad.top} x2={tooltipX} y2={height - pad.bottom} className="guideLine" />}
        {plotPoints.map((point) => (
          <circle
            key={point.id}
            cx={x(point.time)}
            cy={y(point.pace100)}
            r={hovered?.id === point.id ? 7 : point.isPr ? 5 : 4}
            className={`dot ${point.isPr ? "prDot" : "disabledDot"} ${latestPrIds.has(point.id) ? "latestPrDot" : ""} ${hovered?.id === point.id ? "active" : ""}`}
            onPointerEnter={(event) => {
              event.stopPropagation();
              if (point.isPr) setHovered(point);
            }}
          />
        ))}
        {ticks.map((tick) => (
          <text key={tick.label} x={x(tick.time)} y={height - 12} textAnchor="middle" className="axisLabel">
            {tick.label}
          </text>
        ))}
        {hovered && (
          <foreignObject x={tooltipLeft} y={tooltipTop} width={tooltipWidth} height={tooltipHeight} pointerEvents="none">
            <div className="chartTooltip">
              <strong>{formatLongDate(hovered.date)}</strong>
              <span className="tooltipTag">{latestPrIds.has(hovered.id) ? "Current PR" : "New PR"} · {hovered.distance}m · {titleCase(hovered.stroke)}</span>
              <span><em>Pace</em><b>{formatPace(hovered.pace100)}</b></span>
              <span><em>Time</em><b>{formatTime(hovered.timerSeconds)}</b></span>
              <span><em>Heart rate</em><b>{hovered.avgHr || "-"} avg / {hovered.maxHr || "-"} max</b></span>
              <span><em>Strokes / length</em><b>{strokesPerLength(hovered)}</b></span>
              <span><em>Cadence</em><b>{hovered.cadence || 0} spm</b></span>
              <span><em>Pool</em><b>{hovered.poolLength || "-"}m</b></span>
            </div>
          </foreignObject>
        )}
      </svg>
      <div
        className="chartScrubber"
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={() => setScrubDrag(null)}
        onPointerLeave={() => setScrubDrag(null)}
      >
        <div
          className="chartScrubberThumb"
          style={{ left: `${thumbLeft}%`, width: `${Math.min(100 - thumbLeft, thumbWidth)}%` }}
        />
      </div>
    </div>
  );
}

function RollingPaceTrend({ laps }) {
  const [hovered, setHovered] = useState(null);
  const width = 920;
  const height = 300;
  const pad = { left: 54, right: 24, top: 24, bottom: 42 };
  const dates = [...new Set(laps.map((lap) => lap.date))].sort();
  const daily = dates.map((date) => {
    const efforts = laps.filter((lap) => lap.date === date);
    return { date, time: new Date(`${date}T00:00:00`).getTime(), pace: weightedPace(efforts), count: efforts.length };
  }).filter((point) => Number.isFinite(point.pace));
  const rolling = daily.map((point, index) => {
    const window = daily.slice(Math.max(0, index - 4), index + 1);
    return { ...point, rollingPace: window.reduce((sum, item) => sum + item.pace, 0) / window.length, windowSize: window.length };
  });

  if (!rolling.length) return <div className="emptyChart">No matching pace data.</div>;
  const minTime = rolling[0].time;
  const maxTime = rolling[rolling.length - 1].time;
  const values = rolling.flatMap((point) => [point.pace, point.rollingPace]);
  const minPace = Math.min(...values);
  const maxPace = Math.max(...values);
  const x = (time) => pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * (width - pad.left - pad.right);
  const y = (pace) => pad.top + ((pace - minPace) / Math.max(1, maxPace - minPace)) * (height - pad.top - pad.bottom);
  const dailyPath = rolling.map((point, index) => `${index ? "L" : "M"} ${x(point.time)} ${y(point.pace)}`).join(" ");
  const rollingPath = rolling.map((point, index) => `${index ? "L" : "M"} ${x(point.time)} ${y(point.rollingPace)}`).join(" ");
  const ticks = getTicks(rolling, minTime, maxTime);
  const tooltipWidth = 184;
  const tooltipHeight = 94;
  const tooltipX = hovered ? Math.max(8, Math.min(width - tooltipWidth - 8, x(hovered.time) + 12)) : 0;
  const tooltipY = hovered ? Math.max(8, Math.min(height - tooltipHeight - 8, y(hovered.rollingPace) - 48)) : 0;

  return (
    <svg className="chart rollingPaceChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily pace with a rolling five-session average" onPointerLeave={() => setHovered(null)}>
      {[0, 0.5, 1].map((tick) => {
        const yy = pad.top + tick * (height - pad.top - pad.bottom);
        const pace = minPace + tick * (maxPace - minPace);
        return <g key={tick}><line x1={pad.left} y1={yy} x2={width - pad.right} y2={yy} className="grid" /><text x="10" y={yy + 4} className="axisLabel">{formatTime(pace)}</text></g>;
      })}
      <path d={dailyPath} className="dailyPaceLine" />
      <path d={rollingPath} className="rollingPaceLine" />
      {rolling.map((point) => (
        <circle key={point.date} cx={x(point.time)} cy={y(point.rollingPace)} r={hovered?.date === point.date ? 6 : 3.5} className="rollingPoint" onPointerEnter={() => setHovered(point)} />
      ))}
      {ticks.map((tick) => <text key={`${tick.label}-${tick.time}`} x={x(tick.time)} y={height - 12} textAnchor="middle" className="axisLabel">{tick.label}</text>)}
      {hovered && (
        <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} pointerEvents="none">
          <div className="chartTooltip small">
            <strong>{formatLongDate(hovered.date)}</strong>
            <span><em>Rolling pace</em><b>{formatPace(hovered.rollingPace)}</b></span>
            <span><em>Daily pace</em><b>{formatPace(hovered.pace)}</b></span>
            <span><em>Window</em><b>{hovered.windowSize} sessions</b></span>
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function StrokeRatePaceScatter({ laps }) {
  const [hovered, setHovered] = useState(null);
  const width = 460;
  const height = 280;
  const pad = { left: 50, right: 22, top: 18, bottom: 38 };
  const points = laps.filter((lap) => lap.pace100 && lap.cadence > 0);
  if (!points.length) return <div className="emptyChart compact">No stroke-rate data.</div>;
  const minRate = Math.min(...points.map((point) => point.cadence));
  const maxRate = Math.max(...points.map((point) => point.cadence));
  const minPace = Math.min(...points.map((point) => point.pace100));
  const maxPace = Math.max(...points.map((point) => point.pace100));
  const x = (rate) => pad.left + ((rate - minRate) / Math.max(1, maxRate - minRate)) * (width - pad.left - pad.right);
  const y = (pace) => pad.top + ((pace - minPace) / Math.max(1, maxPace - minPace)) * (height - pad.top - pad.bottom);
  const tooltipWidth = 178;
  const tooltipHeight = 112;
  const tooltipX = hovered ? Math.max(8, Math.min(width - tooltipWidth - 8, x(hovered.cadence) + 12)) : 0;
  const tooltipY = hovered ? Math.max(8, Math.min(height - tooltipHeight - 8, y(hovered.pace100) - 56)) : 0;

  return (
    <svg className="chart compactChart strokeRateChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Stroke rate compared with pace" onPointerLeave={() => setHovered(null)}>
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="grid" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="grid" />
      <text x={pad.left} y={height - 8} className="axisLabel">{minRate} spm</text>
      <text x={width - pad.right} y={height - 8} textAnchor="end" className="axisLabel">{maxRate} spm</text>
      <text x="8" y={pad.top + 4} className="axisLabel">{formatTime(minPace)}</text>
      <text x="8" y={height - pad.bottom + 4} className="axisLabel">{formatTime(maxPace)}</text>
      {points.map((point) => <circle key={point.id} cx={x(point.cadence)} cy={y(point.pace100)} r={hovered?.id === point.id ? 6 : 3.7} className="strokeRatePoint" onPointerEnter={() => setHovered(point)} />)}
      {hovered && (
        <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} pointerEvents="none">
          <div className="chartTooltip small">
            <strong>{formatLongDate(hovered.date)}</strong>
            <span className="tooltipTag">{hovered.distance}m · {titleCase(hovered.stroke)}</span>
            <span><em>Pace</em><b>{formatPace(hovered.pace100)}</b></span>
            <span><em>Stroke rate</em><b>{hovered.cadence} spm</b></span>
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

function startOfWeek(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date;
}

function WeeklyVolumeChart({ sessions }) {
  const scrollRef = useRef(null);
  const totals = new Map();
  sessions.forEach((session) => {
    const week = startOfWeek(session.date);
    const key = week.toISOString().slice(0, 10);
    totals.set(key, (totals.get(key) || 0) + (session.normalDistance || 0));
  });
  const keys = [...totals.keys()].sort();
  const weeks = [];
  if (keys.length) {
    const cursor = new Date(`${keys[0]}T00:00:00Z`);
    const end = new Date(`${keys[keys.length - 1]}T00:00:00Z`);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 10);
      weeks.push({ key, date: new Date(cursor), distance: totals.get(key) || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }
  const maxDistance = Math.max(1, ...weeks.map((week) => week.distance));
  const width = Math.max(720, weeks.length * 62);
  const height = 250;
  const pad = { top: 28, right: 18, bottom: 42, left: 18 };
  const plotHeight = height - pad.top - pad.bottom;
  const slotWidth = (width - pad.left - pad.right) / Math.max(1, weeks.length);
  const barWidth = Math.min(30, slotWidth * 0.58);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [sessions]);

  return (
    <div className="weeklyVolumeScroll" ref={scrollRef} aria-label="Weekly swim volume, scroll horizontally for older weeks">
      <svg
        className="weeklyVolumeChart"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${weeks.length} weeks of normal swim volume`}
      >
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="grid" />
        {weeks.map((week, index) => {
          const x = pad.left + index * slotWidth + (slotWidth - barWidth) / 2;
          const barHeight = week.distance ? Math.max(2, (week.distance / maxDistance) * plotHeight) : 0;
          const y = height - pad.bottom - barHeight;
          return (
            <g className="weeklyBarGroup" key={week.key}>
              <title>{`${week.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}: ${(week.distance / 1000).toFixed(1)} km`}</title>
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="2" className="weeklyBar" />
              {week.distance > 0 && <text x={x + barWidth / 2} y={Math.max(13, y - 7)} textAnchor="middle" className="weeklyValue">{(week.distance / 1000).toFixed(1)}k</text>}
              <text x={x + barWidth / 2} y={height - 17} textAnchor="middle" className="weeklyLabel">{week.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function heartRateZone(heartRate, zones) {
  return zones.find((zone) => heartRate >= zone.min && heartRate <= zone.max) || zones[0];
}

function ZoneLegend({ zones }) {
  return (
    <div className="zoneLegend" aria-label="Heart rate zones">
      {zones.map((zone) => (
        <span key={zone.id}><i className={`zoneSwatch ${zone.id}`} />{zone.name}</span>
      ))}
      <span><i className="outlierSwatch" />Outlier</span>
    </div>
  );
}

function HrEfficiency({ laps, zones }) {
  const [hovered, setHovered] = useState(null);
  const width = 460;
  const height = 280;
  const pad = { left: 50, right: 22, top: 24, bottom: 38 };
  const rawPoints = laps.filter((lap) => lap.pace100 && lap.avgHr);

  if (rawPoints.length < 3) return <div className="emptyChart compact">Not enough heart-rate data.</div>;

  const minHr = Math.min(...rawPoints.map((point) => point.avgHr));
  const maxHr = Math.max(...rawPoints.map((point) => point.avgHr));
  const minPace = Math.min(...rawPoints.map((point) => point.pace100));
  const maxPace = Math.max(...rawPoints.map((point) => point.pace100));
  const x = (hr) => pad.left + ((hr - minHr) / Math.max(1, maxHr - minHr)) * (width - pad.left - pad.right);
  const y = (pace) => pad.top + ((pace - minPace) / Math.max(1, maxPace - minPace)) * (height - pad.top - pad.bottom);
  const regression = linearRegression(rawPoints.map((point) => [point.avgHr, point.pace100]));
  const predict = linearRegressionLine(regression);
  const residuals = rawPoints.map((point) => point.pace100 - predict(point.avgHr));
  const residualDeviation = standardDeviation(residuals);
  const xMean = rawPoints.reduce((sum, point) => sum + point.avgHr, 0) / rawPoints.length;
  const sxx = rawPoints.reduce((sum, point) => sum + (point.avgHr - xMean) ** 2, 0);
  const trend = Array.from({ length: 40 }, (_, index) => {
    const hr = minHr + (index / 39) * (maxHr - minHr);
    const pace = predict(hr);
    const margin = 1.96 * residualDeviation * Math.sqrt((1 / rawPoints.length) + ((hr - xMean) ** 2 / Math.max(1, sxx)));
    return { hr, pace, low: pace - margin, high: pace + margin };
  });
  const points = rawPoints.map((point, index) => ({
    ...point,
    zone: heartRateZone(point.avgHr, zones),
    isOutlier: Math.abs(residuals[index]) > residualDeviation * 2,
  }));
  const trendPath = trend.map((point, index) => `${index ? "L" : "M"} ${x(point.hr)} ${y(point.pace)}`).join(" ");
  const confidencePath = [
    ...trend.map((point, index) => `${index ? "L" : "M"} ${x(point.hr)} ${y(point.low)}`),
    ...trend.slice().reverse().map((point) => `L ${x(point.hr)} ${y(point.high)}`),
    "Z",
  ].join(" ");
  const tooltipX = hovered ? x(hovered.avgHr) : 0;
  const tooltipY = hovered ? y(hovered.pace100) : 0;
  const tooltipHeight = 132;
  const tooltipTop = hovered
    ? Math.max(8, Math.min(height - tooltipHeight - 8, tooltipY > height / 2 ? tooltipY - tooltipHeight - 12 : tooltipY + 12))
    : 0;

  return (
    <div className="compactViz">
      <ZoneLegend zones={zones} />
      <svg className="chart compactChart hrScatter" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Swim pace by heart rate with regression and confidence band" onPointerLeave={() => setHovered(null)}>
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="grid" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="grid" />
        <text x={pad.left} y={height - 8} className="axisLabel">{minHr} bpm</text>
        <text x={width - pad.right} y={height - 8} textAnchor="end" className="axisLabel">{maxHr} bpm</text>
        <text x={8} y={pad.top + 4} className="axisLabel">{formatTime(minPace)}</text>
        <text x={8} y={height - pad.bottom + 4} className="axisLabel">{formatTime(maxPace)}</text>
        <path d={confidencePath} className="confidenceBand" />
        <path d={trendPath} className="regressionLine" />
        {points.map((point) => (
          <circle
            key={point.id}
            cx={x(point.avgHr)}
            cy={y(point.pace100)}
            r={hovered?.id === point.id ? 6.5 : point.isOutlier ? 5 : 3.7}
            className={`hrPoint ${point.zone.id} ${point.isOutlier ? "outlier" : ""} ${hovered?.id === point.id ? "active" : ""}`}
            onPointerEnter={() => setHovered(point)}
          />
        ))}
        {hovered && (
          <foreignObject x={Math.min(width - 190, tooltipX + 12)} y={tooltipTop} width="178" height={tooltipHeight} pointerEvents="none">
            <div className="chartTooltip small">
              <strong>{formatLongDate(hovered.date)}</strong>
              <span className="tooltipTag">{hovered.distance}m · {titleCase(hovered.stroke)}</span>
              <span><em>Pace</em><b>{formatPace(hovered.pace100)}</b></span>
              <span><em>Avg HR</em><b>{hovered.avgHr} bpm · {hovered.zone.name}</b></span>
              {hovered.isOutlier && <span><em>Signal</em><b>Outlier</b></span>}
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

function HeartRateDensity({ laps, zones }) {
  const [hovered, setHovered] = useState(null);
  const width = 460;
  const height = 270;
  const pad = { left: 50, right: 22, top: 18, bottom: 38 };
  const source = laps.filter((lap) => lap.pace100 && lap.avgHr);
  if (!source.length) return <div className="emptyChart compact">No heart-rate data.</div>;

  const minHr = Math.min(...source.map((point) => point.avgHr));
  const maxHr = Math.max(...source.map((point) => point.avgHr));
  const minPace = Math.min(...source.map((point) => point.pace100));
  const maxPace = Math.max(...source.map((point) => point.pace100));
  const x = (hr) => pad.left + ((hr - minHr) / Math.max(1, maxHr - minHr)) * (width - pad.left - pad.right);
  const y = (pace) => pad.top + ((pace - minPace) / Math.max(1, maxPace - minPace)) * (height - pad.top - pad.bottom);
  const screenPoints = source.map((point) => ({ ...point, x: x(point.avgHr), y: y(point.pace100) }));
  const hex = createHexbin().x((point) => point.x).y((point) => point.y).radius(13).extent([[pad.left, pad.top], [width - pad.right, height - pad.bottom]]);
  const bins = hex(screenPoints).map((bin) => ({
    x: bin.x,
    y: bin.y,
    count: bin.length,
    avgHr: bin.reduce((sum, point) => sum + point.avgHr, 0) / bin.length,
    avgPace: bin.reduce((sum, point) => sum + point.pace100, 0) / bin.length,
  }));
  const maxCount = Math.max(...bins.map((bin) => bin.count));

  return (
    <div className="compactViz">
      <ZoneLegend zones={zones} />
      <svg className="chart compactChart densityChart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Density of swim efforts by heart rate and pace" onPointerLeave={() => setHovered(null)}>
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="grid" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="grid" />
        <text x={pad.left} y={height - 8} className="axisLabel">{minHr} bpm</text>
        <text x={width - pad.right} y={height - 8} textAnchor="end" className="axisLabel">{maxHr} bpm</text>
        <text x={8} y={pad.top + 4} className="axisLabel">{formatTime(minPace)}</text>
        <text x={8} y={height - pad.bottom + 4} className="axisLabel">{formatTime(maxPace)}</text>
        {bins.map((bin, index) => {
          const zone = heartRateZone(bin.avgHr, zones);
          return (
            <path
              key={`${bin.x}-${bin.y}-${index}`}
              d={hex.hexagon()}
              transform={`translate(${bin.x},${bin.y})`}
              className={`hexCell ${zone.id}`}
              style={{ opacity: 0.2 + (bin.count / maxCount) * 0.8 }}
              onPointerEnter={() => setHovered({ ...bin, zone })}
            />
          );
        })}
        {hovered && (
          <foreignObject x={Math.min(width - 190, hovered.x + 12)} y={Math.max(8, Math.min(height - 104, hovered.y - 48))} width="178" height="96" pointerEvents="none">
            <div className="chartTooltip small">
              <strong>{hovered.count} efforts</strong>
              <span><em>Average pace</em><b>{formatPace(hovered.avgPace)}</b></span>
              <span><em>Average HR</em><b>{Math.round(hovered.avgHr)} bpm</b></span>
              <span><em>Zone</em><b>{hovered.zone.name}</b></span>
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

function HardEffortTrend({ sessions }) {
  const rows = sessions
    .map((session) => ({ ...session, hard: hardShare(session) }))
    .filter((session) => session.hard !== null)
    .slice(-12);

  return (
    <div className="hardRows">
      {rows.map((session) => (
        <div className="hardRow" key={session.id}>
          <span>{shortDate(session.date)}</span>
          <div className="hardTrack">
            <i style={{ width: `${Math.round(session.hard * 100)}%` }} />
          </div>
          <strong>{Math.round(session.hard * 100)}%</strong>
        </div>
      ))}
    </div>
  );
}

function App() {
  const fitInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const [data, setData] = useState(null);
  const [page, setPage] = useState("swim");
  const [distance, setDistance] = useState("All");
  const [stroke, setStroke] = useState("All");
  const [poolLength, setPoolLength] = useState("All");
  const [hrDistance, setHrDistance] = useState("All");
  const [densityDistance, setDensityDistance] = useState("All");
  const [paceTrendDistance, setPaceTrendDistance] = useState(25);
  const [paceTrendStroke, setPaceTrendStroke] = useState("All");
  const [timeRange, setTimeRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [filesPage, setFilesPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [selectedActivities, setSelectedActivities] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    fetch("/data/swims.json").then((res) => res.json()).then(setData);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  const showToast = (message, type = "success") => {
    clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  };

  const importFitFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".fit")) {
      showToast("Choose a .fit file.", "error");
      event.target.value = "";
      return;
    }

    setImporting(true);
    setToast(null);
    try {
      const response = await fetch(`/api/import-fit?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The FIT file could not be imported.");
      setData(result);
      setFilesPage(1);
      setSelectedActivities(new Set());
      showToast(`${file.name} imported`);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const toggleActivity = (file) => {
    setSelectedActivities((current) => {
      const next = new Set(current);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const deleteSelectedActivities = async () => {
    const files = [...selectedActivities];
    if (!files.length) return;
    setConfirmDelete(false);
    setDeleting(true);
    setToast(null);
    try {
      const response = await fetch("/api/delete-activities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The selected activities could not be deleted.");
      setData(result);
      setSelectedActivities(new Set());
      setFilesPage((current) => Math.min(current, Math.max(1, Math.ceil(result.sessions.length / filesPerPage))));
      showToast(`${files.length} ${files.length === 1 ? "activity" : "activities"} deleted`);
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      setDeleting(false);
    }
  };

  const derived = useMemo(() => {
    if (!data) return null;
    const normalLaps = flatten(data, "laps").filter((lap) => lap.distance > 0 && lap.type === "normal" && lap.stroke !== "rest");
    const drills = flatten(data, "drills");
    const distances = [...new Set(normalLaps.map((lap) => lap.distance))].sort((a, b) => a - b);
    const longDistances = distances.filter((item) => item > 400);
    const strokes = [...new Set(normalLaps.map((lap) => lap.stroke))]
      .filter((item) => item && item !== "rest")
      .sort();
    const filterLaps = (laps, selectedDistance, selectedStroke, selectedPool = "All") => laps.filter((lap) => {
      const distanceMatch = selectedDistance === "All" || lap.distance === selectedDistance;
      const strokeMatch = selectedStroke === "All" || lap.stroke === selectedStroke.toLowerCase();
      const poolMatch = selectedPool === "All" || Number(lap.poolLength) === Number(selectedPool);
      return distanceMatch && strokeMatch && poolMatch;
    });
    const anchorDate = normalLaps.reduce((latest, lap) => !latest || lap.date > latest ? lap.date : latest, "");
    const matchingLaps = markPersonalRecords(filterLaps(normalLaps, distance, stroke, poolLength), stroke !== "All");
    const filtered = filterByTimeRange(matchingLaps, timeRange, customStart, customEnd, anchorDate);
    const hrFiltered = filterLaps(normalLaps, hrDistance, "All");
    const densityFiltered = filterLaps(normalLaps, densityDistance, "All");
    const paceTrendFiltered = filterLaps(normalLaps, paceTrendDistance, paceTrendStroke);
    const activitySessions = [...data.sessions].sort((a, b) => {
      const dateOrder = new Date(b.startTime || `${b.date}T00:00:00`) - new Date(a.startTime || `${a.date}T00:00:00`);
      return dateOrder || String(b.id).localeCompare(String(a.id));
    });
    return { normalLaps, drills, distances, longDistances, strokes, filtered, hrFiltered, densityFiltered, paceTrendFiltered, anchorDate, activitySessions };
  }, [data, distance, stroke, poolLength, hrDistance, densityDistance, paceTrendDistance, paceTrendStroke, timeRange, customStart, customEnd]);

  if (!data || !derived) return <div className="loading">Loading swim data</div>;

  const totalDistance = data.sessions.reduce((sum, session) => sum + session.normalDistance, 0);
  const totalNormalTime = data.sessions.reduce((sum, session) => sum + session.normalTimerSeconds, 0);
  const totalDrills = data.sessions.reduce((sum, session) => sum + session.drillDistance, 0);
  const normalPace = totalDistance > 0 ? (totalNormalTime * 100) / totalDistance : null;
  const avgHr = average(data.sessions.map((session) => session.avgHr));
  const selectedPace = weightedPace(derived.filtered);
  const selectedBest = bestPace(derived.filtered);
  const selectedLabel = distance === "All" ? "All efforts" : `${distance}m`;
  const filePageCount = Math.max(1, Math.ceil(data.sessions.length / filesPerPage));
  const safeFilesPage = Math.min(filesPage, filePageCount);
  const pageStart = (safeFilesPage - 1) * filesPerPage;
  const pageEnd = Math.min(data.sessions.length, pageStart + filesPerPage);
  const visibleSessions = derived.activitySessions.slice(pageStart, pageEnd);
  const emptyFileRows = Array.from({ length: filesPerPage - visibleSessions.length });
  const visibleFiles = visibleSessions.map((session) => session.file);
  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every((file) => selectedActivities.has(file));
  const toggleVisibleActivities = () => {
    setSelectedActivities((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleFiles.forEach((file) => next.delete(file));
      else visibleFiles.forEach((file) => next.add(file));
      return next;
    });
  };

  return (
    <main className="shell">
      <aside className="rail">
        <div>
          <div className="brand">Swim Progress</div>
          <p className="railMeta">Coros pool swim analysis</p>
        </div>
        <nav>
          <button className={page === "swim" ? "navButton active" : "navButton"} onClick={() => setPage("swim")}>
            <Activity className="navIcon" aria-hidden="true" />
            <span>Swim</span>
          </button>
          <button className={page === "files" ? "navButton active" : "navButton"} onClick={() => setPage("files")}>
            <Files className="navIcon" aria-hidden="true" />
            <span>Activities</span>
          </button>
        </nav>
      </aside>

      <section className="content">
        {page === "swim" ? (
          <>
        <header className="hero compactHero">
          <p className="kicker">Swim analytics</p>
          <h1>Swim Analytics</h1>
          <div className="heroMeta">
            <span>{data.sessions.length} sessions</span>
            <span>{derived.normalLaps.length} normal efforts</span>
            <span>{derived.distances.length} lap distances</span>
          </div>
        </header>

        <section className="metricGrid">
          <Metric label="Swim volume" value={formatDistance(totalDistance)} detail="Normal swim only" icon={Waves} />
          <Metric label="Drill volume" value={formatDistance(totalDrills)} detail="Kept separate" icon={Repeat2} />
          <Metric label="Normal pace" value={formatPace(normalPace)} detail="Weighted by lap distance" icon={Timer} />
          <Metric label="Average HR" value={`${Math.round(avgHr)} bpm`} detail="Session average" icon={HeartPulse} />
        </section>

        <section className="panel" id="efforts">
          <div className="sectionTabsRow">
            <StrokeTabs
              value={stroke}
              options={["All", ...derived.strokes.map(titleCase)]}
              onChange={setStroke}
            />
            <div className="tabTools">
              {timeRange === "custom" && (
                <div className="customDateRange" aria-label="Custom date range">
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd || derived.anchorDate}
                      onChange={(event) => setCustomStart(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>To</span>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      max={derived.anchorDate}
                      onChange={(event) => setCustomEnd(event.target.value)}
                    />
                  </label>
                </div>
              )}
              <PoolLengthMenu value={poolLength} onChange={setPoolLength} />
              <TimeRangeMenu value={timeRange} onChange={setTimeRange} />
            </div>
          </div>
          <div className="panelTop">
            <div>
              <p className="kicker">Effort trends</p>
              <h2>Pace by lap distance</h2>
              <p className="panelNote">Each point is an effort, with chronological PRs emphasized and the current record shown in orange.</p>
            </div>
            <div className="filters">
              <Segmented
                value={distance}
                options={["All", ...shortFilters.filter((item) => derived.distances.includes(item))]}
                onChange={setDistance}
                format={(item) => (item === "All" ? "All" : `${item}m`)}
              />
              <LongerMenu value={distance} distances={derived.longDistances} onChange={setDistance} />
            </div>
          </div>

          <div className="contextStats">
            <Metric label={`Average pace · ${selectedLabel}`} value={formatPace(selectedPace)} detail={`${derived.filtered.length} matching efforts`} />
            <Metric label={`Best pace · ${selectedLabel}`} value={formatPace(selectedBest)} detail="Fastest visible normal effort" />
          </div>

          <PaceTrend laps={derived.filtered} />
        </section>

        <section className="panel" id="pace-trend">
          <div className="sectionTabsRow">
            <StrokeTabs
              value={paceTrendStroke}
              options={["All", ...derived.strokes.map(titleCase)]}
              onChange={setPaceTrendStroke}
            />
            <div className="tabTools">
              <DistanceDropdown value={paceTrendDistance} distances={derived.distances} onChange={setPaceTrendDistance} allowAll={false} />
            </div>
          </div>
          <div className="panelTop">
            <div>
              <p className="kicker">Pace trend</p>
              <h2>Rolling pace</h2>
              <p className="panelNote">Daily pace is paired with a five-session rolling average to reveal sustained changes.</p>
            </div>
          </div>
          <RollingPaceTrend laps={derived.paceTrendFiltered} />
        </section>

        <section className="split" id="technique-heart-rate">
          <div className="panel">
            <div className="panelTop">
              <div>
                <p className="kicker">Technique</p>
                <h2>Stroke rate vs pace</h2>
                <p className="panelNote">Each effort compares device-reported stroke rate with normalized pace.</p>
              </div>
            </div>
            <StrokeRatePaceScatter laps={derived.paceTrendFiltered} />
          </div>

          <div className="panel">
            <div className="panelTop">
              <div>
                <p className="kicker">Heart rate</p>
                <h2>Pace vs heart rate</h2>
                <p className="panelNote">Regression and its confidence band show how pace changes as heart rate rises.</p>
              </div>
              <div className="filters compactFilters">
                <DistanceDropdown value={hrDistance} distances={derived.distances} onChange={setHrDistance} />
              </div>
            </div>
            <HrEfficiency laps={derived.hrFiltered} zones={data.zones} />
          </div>
        </section>

        <section className="split" id="heart-distribution">
          <div className="panel">
            <div className="panelTop">
              <div>
                <p className="kicker">Heart rate</p>
                <h2>Effort density</h2>
                <p className="panelNote">Hexagons reveal where pace and heart-rate combinations occur most often.</p>
              </div>
              <div className="filters compactFilters">
                <DistanceDropdown value={densityDistance} distances={derived.distances} onChange={setDensityDistance} />
              </div>
            </div>
            <HeartRateDensity laps={derived.densityFiltered} zones={data.zones} />
          </div>

          <div className="panel">
            <div className="panelTop">
              <div>
                <p className="kicker">Intensity</p>
                <h2>Hard effort share</h2>
                <p className="panelNote">Each bar shows the share of session time spent in heart-rate zones Z4 and Z5.</p>
              </div>
            </div>
            <HardEffortTrend sessions={data.sessions} />
          </div>
        </section>

        <section className="panel" id="weekly-volume">
          <div className="panelTop">
            <div>
              <p className="kicker">Training volume</p>
              <h2>Weekly swim volume</h2>
              <p className="panelNote">Weekly normal-swim distance is shown chronologically, with older weeks available by horizontal scroll.</p>
            </div>
          </div>
          <WeeklyVolumeChart sessions={data.sessions} />
        </section>
          </>
        ) : (
          <>
            <header className="hero activitiesHero">
              <div className="heroTop">
                <div>
                  <p className="kicker">Data audit</p>
                  <h1>Activities</h1>
                </div>
                <div className="importControl">
                  <input
                    ref={fitInputRef}
                    className="visuallyHidden"
                    type="file"
                    accept=".fit"
                    onChange={importFitFile}
                  />
                  <button
                    type="button"
                    className="importButton"
                    disabled={importing}
                    onClick={() => fitInputRef.current?.click()}
                  >
                    <Upload aria-hidden="true" />
                    {importing ? "importing" : "import .fit"}
                  </button>
                  {importing && (
                    <div className="importProgress" role="progressbar" aria-label="Importing FIT activity">
                      <span />
                    </div>
                  )}
                </div>
              </div>
              <div className="heroMeta">
                <span>{data.sessions.length} activities</span>
                <span>{formatDistance(totalDistance)} normal swim</span>
                <span>{formatDistance(totalDrills)} drills</span>
              </div>
            </header>

        <section className="panel">
          <div className="panelTop">
            <div>
              <p className="kicker">Sessions</p>
              <h2>Imported activities</h2>
            </div>
            {selectedActivities.size > 0 && (
              <div className="selectionActions">
                <strong>{selectedActivities.size} selected</strong>
                <button type="button" className="deleteButton" onClick={() => setConfirmDelete(true)} disabled={deleting}>
                  <Trash2 aria-hidden="true" />
                  {deleting ? "Deleting" : "Delete"}
                </button>
                {deleting && <span className="selectionProgress" aria-label="Deleting selected activities" />}
              </div>
            )}
          </div>
          <div className="sessionList">
            <div className="sessionRow sessionHeader">
              <label className="activityCheckbox selectPageCheckbox">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleActivities} />
                <span className="visuallyHidden">Select all activities on this page</span>
              </label>
              <span>Date</span>
              <span>Swim</span>
              <span>Drills</span>
              <span>Pace</span>
              <span>Avg HR</span>
              <span>Pool</span>
              <span>File</span>
            </div>
            {visibleSessions.map((session) => (
              <div className={selectedActivities.has(session.file) ? "sessionRow selected" : "sessionRow"} key={session.id}>
                <label className="activityCheckbox">
                  <input
                    type="checkbox"
                    checked={selectedActivities.has(session.file)}
                    onChange={() => toggleActivity(session.file)}
                  />
                  <span className="visuallyHidden">Select {shortDate(session.date)} activity</span>
                </label>
                <span>{shortDate(session.date)}</span>
                <span>{formatDistance(session.normalDistance)}</span>
                <span>{formatDistance(session.drillDistance)}</span>
                <span>{formatPace(session.normalPace100)}</span>
                <span>{session.avgHr} bpm</span>
                <span>{session.poolLength ? `${session.poolLength}m pool` : "-"}</span>
                <span>{session.file}</span>
              </div>
            ))}
            {emptyFileRows.map((_, index) => (
              <div className="sessionRow placeholderRow" key={`placeholder-${index}`} aria-hidden="true">
                <span>&nbsp;</span>
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
          <div className="pagination">
            <span>Showing {pageStart + 1}-{pageEnd} of {data.sessions.length}</span>
            <div className="paginationControls" aria-label="Imported files pages">
              <button type="button" disabled={safeFilesPage === 1} onClick={() => setFilesPage(1)} aria-label="First page">
                <ChevronsLeft aria-hidden="true" />
              </button>
              <button type="button" disabled={safeFilesPage === 1} onClick={() => setFilesPage((current) => Math.max(1, current - 1))} aria-label="Previous page">
                <ChevronLeft aria-hidden="true" />
              </button>
              <strong>
                <span className="currentPage">Page {safeFilesPage}</span>
                <span className="pageTotal"> of {filePageCount}</span>
              </strong>
              <button type="button" disabled={safeFilesPage === filePageCount} onClick={() => setFilesPage((current) => Math.min(filePageCount, current + 1))} aria-label="Next page">
                <ChevronRight aria-hidden="true" />
              </button>
              <button type="button" disabled={safeFilesPage === filePageCount} onClick={() => setFilesPage(filePageCount)} aria-label="Last page">
                <ChevronsRight aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
          </>
        )}
      </section>
      {confirmDelete && (
        <div className="modalBackdrop" role="presentation">
          <div className="confirmDialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
            <p className="kicker">Confirm deletion</p>
            <h2 id="delete-title">Delete {selectedActivities.size} {selectedActivities.size === 1 ? "activity" : "activities"}?</h2>
            <p id="delete-description">The selected FIT {selectedActivities.size === 1 ? "file" : "files"} and associated swim data will be permanently removed.</p>
            <div className="dialogActions">
              <button type="button" className="cancelButton" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
              <button type="button" className="confirmDeleteButton" onClick={deleteSelectedActivities} disabled={deleting}>
                <Trash2 aria-hidden="true" />
                {deleting ? "Deleting" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className={`snackbar ${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
          {toast.type === "error" ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          <span>{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <X aria-hidden="true" />
          </button>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
