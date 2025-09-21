import { Campaign } from '../entities/Campaign';

export interface TimeWindow {
  start: Date;
  end: Date;
  isToday: boolean;
  remainingMinutes: number;
}

export interface ScheduleResult {
  canScheduleNow: boolean;
  nextAvailableTime: Date;
  currentWindow: TimeWindow | null;
  nextWindow: TimeWindow | null;
  reason: string;
}

export class CampaignTimeScheduler {
  
  /**
   * Check if campaign can run at current time and get next available slot
   */
  static getScheduleInfo(campaign: Campaign, referenceTime: Date = new Date()): ScheduleResult {
    // If campaign runs all day, always available
    if (campaign.isAllDay || !campaign.hasTimeRestrictions) {
      return {
        canScheduleNow: true,
        nextAvailableTime: referenceTime,
        currentWindow: null,
        nextWindow: null,
        reason: 'Campaign runs 24/7'
      };
    }

    const currentWindow = this.getCurrentTimeWindow(campaign, referenceTime);
    const nextWindow = this.getNextTimeWindow(campaign, referenceTime);

    // If we're in a valid time window
    if (currentWindow && this.isWithinWindow(referenceTime, currentWindow)) {
      return {
        canScheduleNow: true,
        nextAvailableTime: referenceTime,
        currentWindow,
        nextWindow,
        reason: `Within time window (${currentWindow.remainingMinutes} minutes remaining)`
      };
    }

    // Not in window, return next available time
    return {
      canScheduleNow: false,
      nextAvailableTime: nextWindow?.start || referenceTime,
      currentWindow: null,
      nextWindow,
      reason: nextWindow 
        ? `Outside time window. Next window starts at ${nextWindow.start.toLocaleTimeString()}`
        : 'No valid time window found'
    };
  }

  /**
   * Calculate when jobs should be scheduled considering time windows
   */
  static scheduleJobsWithTimeWindows(
    campaign: Campaign, 
    totalJobs: number, 
    startTime: Date = new Date()
  ): { scheduledTimes: Date[]; estimatedCompletion: Date } {
    const scheduledTimes: Date[] = [];
    
    if (campaign.isAllDay || !campaign.hasTimeRestrictions) {
      // Original logic for all-day campaigns
      return this.scheduleJobsAllDay(campaign, totalJobs, startTime);
    }

    let currentTime = new Date(startTime);
    let jobsScheduled = 0;

    while (jobsScheduled < totalJobs) {
      const scheduleInfo = this.getScheduleInfo(campaign, currentTime);
      
      if (scheduleInfo.canScheduleNow && scheduleInfo.currentWindow) {
        // Schedule as many jobs as possible in current window
        const jobsInWindow = this.scheduleJobsInWindow(
          campaign, 
          scheduleInfo.currentWindow, 
          currentTime, 
          totalJobs - jobsScheduled
        );
        
        scheduledTimes.push(...jobsInWindow);
        jobsScheduled += jobsInWindow.length;
        
        // Move to end of current window
        currentTime = scheduleInfo.currentWindow.end;
      }
      
      // Move to next available window
      if (jobsScheduled < totalJobs) {
        const nextWindow = this.getNextTimeWindow(campaign, currentTime);
        if (nextWindow) {
          currentTime = nextWindow.start;
        } else {
          // No more windows available, break
          console.warn(`Could only schedule ${jobsScheduled}/${totalJobs} jobs within time constraints`);
          break;
        }
      }
    }

    const estimatedCompletion = scheduledTimes.length > 0 
      ? scheduledTimes[scheduledTimes.length - 1] 
      : startTime;

    return { scheduledTimes, estimatedCompletion };
  }

  /**
   * Schedule jobs within a specific time window
   */
  private static scheduleJobsInWindow(
    campaign: Campaign, 
    window: TimeWindow, 
    startTime: Date, 
    maxJobs: number
  ): Date[] {
    const scheduledTimes: Date[] = [];
    const avgInterval = (campaign.minIntervalMinutes + campaign.maxIntervalMinutes) / 2;
    const windowDurationMinutes = window.remainingMinutes;
    
    // Calculate how many jobs can fit in this window
    const maxJobsInWindow = Math.floor(windowDurationMinutes / avgInterval);
    const jobsToSchedule = Math.min(maxJobs, maxJobsInWindow);
    
    let currentTime = new Date(startTime);
    
    for (let i = 0; i < jobsToSchedule; i++) {
      // Ensure we don't schedule past window end
      if (currentTime >= window.end) break;
      
      scheduledTimes.push(new Date(currentTime));
      
      // Calculate next job time with random interval
      const randomInterval = this.getRandomInterval(campaign);
      currentTime = new Date(currentTime.getTime() + (randomInterval * 60 * 1000));
    }

    return scheduledTimes;
  }

  /**
   * Get current time window if active
   */
  private static getCurrentTimeWindow(campaign: Campaign, referenceTime: Date): TimeWindow | null {
    if (!campaign.dailyStartTime || !campaign.dailyEndTime) return null;

    const todayStart = this.parseTimeToDate(campaign.dailyStartTime, referenceTime);
    const todayEnd = this.parseTimeToDate(campaign.dailyEndTime, referenceTime);

    // Handle overnight windows (e.g., 22:00 to 06:00)
    if (todayStart > todayEnd) {
      // Check if we're in the late part of the window (today 22:00 to tomorrow 00:00)
      if (referenceTime >= todayStart) {
        const tomorrowEnd = new Date(todayEnd);
        tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
        return {
          start: todayStart,
          end: tomorrowEnd,
          isToday: true,
          remainingMinutes: Math.floor((tomorrowEnd.getTime() - referenceTime.getTime()) / 60000)
        };
      }
      
      // Check if we're in the early part of the window (yesterday 22:00 to today 06:00)
      if (referenceTime <= todayEnd) {
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        return {
          start: yesterdayStart,
          end: todayEnd,
          isToday: true,
          remainingMinutes: Math.floor((todayEnd.getTime() - referenceTime.getTime()) / 60000)
        };
      }
    } else {
      // Normal same-day window (e.g., 02:00 to 05:00)
      if (referenceTime >= todayStart && referenceTime <= todayEnd) {
        return {
          start: todayStart,
          end: todayEnd,
          isToday: true,
          remainingMinutes: Math.floor((todayEnd.getTime() - referenceTime.getTime()) / 60000)
        };
      }
    }

    return null;
  }

  /**
   * Get next available time window
   */
  private static getNextTimeWindow(campaign: Campaign, referenceTime: Date): TimeWindow | null {
    if (!campaign.dailyStartTime || !campaign.dailyEndTime) return null;

    const todayStart = this.parseTimeToDate(campaign.dailyStartTime, referenceTime);
    const todayEnd = this.parseTimeToDate(campaign.dailyEndTime, referenceTime);

    // If today's window hasn't started yet
    if (referenceTime < todayStart) {
      return {
        start: todayStart,
        end: todayStart > todayEnd ? 
          new Date(todayEnd.getTime() + (24 * 60 * 60 * 1000)) : 
          todayEnd,
        isToday: true,
        remainingMinutes: this.calculateWindowDuration(campaign)
      };
    }

    // Get tomorrow's window
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    
    const tomorrowEnd = new Date(todayEnd);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + (todayStart > todayEnd ? 2 : 1));

    return {
      start: tomorrowStart,
      end: tomorrowEnd,
      isToday: false,
      remainingMinutes: this.calculateWindowDuration(campaign)
    };
  }

  /**
   * Check if time is within window
   */
  private static isWithinWindow(time: Date, window: TimeWindow): boolean {
    return time >= window.start && time <= window.end;
  }

  /**
   * Parse time string to Date object for today
   */
  private static parseTimeToDate(timeString: string, referenceDate: Date): Date {
    const [hours, minutes, seconds] = timeString.split(':').map(Number);
    const date = new Date(referenceDate);
    date.setHours(hours, minutes, seconds || 0, 0);
    return date;
  }

  /**
   * Calculate window duration in minutes
   */
  private static calculateWindowDuration(campaign: Campaign): number {
    if (!campaign.dailyStartTime || !campaign.dailyEndTime) return 0;

    const start = campaign.dailyStartTimeAsDate;
    const end = campaign.dailyEndTimeAsDate;
    
    if (!start || !end) return 0;

    let duration = (end.getTime() - start.getTime()) / 60000;
    
    // Handle overnight windows
    if (duration < 0) {
      duration += 24 * 60; // Add 24 hours in minutes
    }
    
    return Math.floor(duration);
  }

  /**
   * Get random interval between min and max
   */
  private static getRandomInterval(campaign: Campaign): number {
    return Math.floor(
      Math.random() * (campaign.maxIntervalMinutes - campaign.minIntervalMinutes + 1)
    ) + campaign.minIntervalMinutes;
  }

  /**
   * Fallback for all-day campaigns
   */
  private static scheduleJobsAllDay(
    campaign: Campaign, 
    totalJobs: number, 
    startTime: Date
  ): { scheduledTimes: Date[]; estimatedCompletion: Date } {
    const scheduledTimes: Date[] = [];
    let currentTime = new Date(startTime);

    for (let i = 0; i < totalJobs; i++) {
      scheduledTimes.push(new Date(currentTime));
      
      const randomInterval = this.getRandomInterval(campaign);
      currentTime = new Date(currentTime.getTime() + (randomInterval * 60 * 1000));
    }

    return { 
      scheduledTimes, 
      estimatedCompletion: scheduledTimes[scheduledTimes.length - 1] || startTime 
    };
  }

  /**
   * Check if enough time remaining in current window for at least one job
   */
  static hasEnoughTimeForJob(campaign: Campaign, referenceTime: Date = new Date()): boolean {
    if (campaign.isAllDay) return true;

    const scheduleInfo = this.getScheduleInfo(campaign, referenceTime);
    
    if (!scheduleInfo.canScheduleNow || !scheduleInfo.currentWindow) {
      return false;
    }

    // Check if remaining time is at least the minimum interval
    return scheduleInfo.currentWindow.remainingMinutes >= campaign.minIntervalMinutes;
  }

  /**
   * Format time window for display
   */
  static formatTimeWindow(window: TimeWindow | null): string {
    if (!window) return 'No time window';

    const startStr = window.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endStr = window.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return `${startStr} - ${endStr} (${window.remainingMinutes} min remaining)`;
  }
}