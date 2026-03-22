import { useState } from 'react';
import { useListAppointments } from '@workspace/api-client-react';
import { AppLayout } from '@/components/layout';
import { Button } from '@/components/ui';
import { AppointmentStatusBadge } from '@/components/status-badge';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { useLocation } from 'wouter';

export function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<'month' | 'week'>('month');
  const [, setLocation] = useLocation();

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const { data } = useListAppointments({
    startDate: calStart.toISOString(),
    endDate: calEnd.toISOString(),
    page: 1,
    limit: 200,
  } as any);

  const appointments = data?.appointments ?? [];

  const getAppsForDay = (day: Date) =>
    appointments.filter(a => isSameDay(new Date(a.scheduledStart), day));

  const STATUS_DOT: Record<string, string> = {
    pending: 'bg-yellow-400',
    confirmed: 'bg-blue-400',
    in_progress: 'bg-purple-400',
    completed: 'bg-green-400',
    cancelled: 'bg-gray-400',
    no_show: 'bg-red-400',
  };

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Calendar</h1>
          <p className="text-muted-foreground mt-1">Your schedule at a glance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['month', 'week'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${view === v ? 'bg-primary text-white' : 'bg-card text-muted-foreground hover:text-foreground'}`}>
                {v}
              </button>
            ))}
          </div>
          <Button onClick={() => setLocation('/appointments')}><Plus className="w-4 h-4 mr-2" />New Job</Button>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 shadow-sm overflow-hidden">
        {/* Month navigator */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <button onClick={() => setCurrentDate(subMonths(currentDate, 1))} className="p-2 rounded-lg hover:bg-accent transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-lg font-display font-bold">{format(currentDate, 'MMMM yyyy')}</h2>
          <button onClick={() => setCurrentDate(addMonths(currentDate, 1))} className="p-2 rounded-lg hover:bg-accent transition-colors">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="py-3 text-center text-xs font-semibold text-muted-foreground">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 auto-rows-fr">
          {days.map((day, i) => {
            const dayAppts = getAppsForDay(day);
            const isCurrentMonth = day.getMonth() === currentDate.getMonth();
            const isTodayDate = isToday(day);

            return (
              <div key={i} className={`min-h-[100px] p-2 border-b border-r border-border/50 ${!isCurrentMonth ? 'bg-accent/20' : 'hover:bg-accent/30'} transition-colors`}>
                <div className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium mb-1 ${
                  isTodayDate ? 'bg-primary text-primary-foreground' : isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/40'
                }`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayAppts.slice(0, 3).map(appt => (
                    <div
                      key={appt.id}
                      className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-primary/10 hover:bg-primary/20 cursor-pointer transition-colors group"
                      onClick={() => setLocation(`/appointments`)}
                      title={`${appt.customerName} - ${appt.serviceName || 'Service'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[appt.status] || 'bg-gray-400'}`} />
                      <span className="text-xs text-foreground truncate leading-tight">
                        {format(new Date(appt.scheduledStart), 'h:mm')} {appt.customerName?.split(' ')[0]}
                      </span>
                    </div>
                  ))}
                  {dayAppts.length > 3 && (
                    <div className="text-xs text-muted-foreground px-1.5">+{dayAppts.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 mt-4 text-xs text-muted-foreground">
        {Object.entries(STATUS_DOT).map(([status, color]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            {status.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
          </div>
        ))}
      </div>
    </AppLayout>
  );
}
