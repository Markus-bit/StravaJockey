import { describe, expect, it } from "vitest";
import {
  defaultActivityName, formatDuration, formatPaceValue, fromUnitValue, localDateString, startTimeISO, toUnitValue,
  type ActivitySettings, type PaceUnit,
} from "../frontend/src/activity";

describe("frontend unit conversions", () => {
  it("converts pace/speed units back and forth", () => {
    for (const unit of ["min/km", "min/mi", "km/h", "mph"] as PaceUnit[]) {
      expect(fromUnitValue(toUnitValue(330, unit), unit)).toBeCloseTo(330, 6);
    }
    expect(toUnitValue(300, "min/km")).toBe(5);
    expect(toUnitValue(144, "km/h")).toBeCloseTo(25, 6);
  });

  it("formats pace, speed and duration", () => {
    expect(formatPaceValue(330, "min/km")).toBe("5:30");
    expect(formatPaceValue(359.9, "min/km")).toBe("6:00"); // no "5:60"
    expect(formatPaceValue(144, "km/h")).toBe("25.0");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(65)).toBe("1:05");
  });

  it("names activities like Strava by time of day", () => {
    expect(defaultActivityName("run", 7)).toBe("Morning Run");
    expect(defaultActivityName("bike", 19)).toBe("Evening Ride");
    expect(defaultActivityName("run", 2)).toBe("Night Run");
  });

  it("turns the local date and time into an ISO time", () => {
    const s = { date: "2026-11-10", hour: 14, minute: 41 } as ActivitySettings;
    expect(new Date(startTimeISO(s)).getTime()).toBe(new Date(2026, 10, 10, 14, 41).getTime());
    expect(localDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
