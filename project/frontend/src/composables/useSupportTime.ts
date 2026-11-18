import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

/** Time formatting shared by the Support pages: short relative times for
 *  lists ("5 min ago"), absolute ones for the thread, and day labels for the
 *  thread's date separators ("Today", "Yesterday", "12 Nov"). */
export function useSupportTime() {
  const { t, locale } = useI18n()
  const rtf = computed(() => new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' }))

  function ago(iso: string): string {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
    if (min < 1) return rtf.value.format(0, 'minute')
    if (min < 60) return rtf.value.format(-min, 'minute')
    const hr = Math.round(min / 60)
    if (hr < 24) return rtf.value.format(-hr, 'hour')
    const days = Math.round(hr / 24)
    if (days < 7) return rtf.value.format(-days, 'day')
    return new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })
  }

  function dateTime(iso: string): string {
    return new Date(iso).toLocaleString(locale.value, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function time(iso: string): string {
    return new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
  }

  function dayKey(iso: string): string {
    return new Date(iso).toDateString()
  }

  function dayLabel(iso: string): string {
    const d = new Date(iso)
    const today = new Date()
    const yesterday = new Date(Date.now() - 86_400_000)
    if (d.toDateString() === today.toDateString()) return t('support.today')
    if (d.toDateString() === yesterday.toDateString()) return t('support.yesterday')
    return d.toLocaleDateString(locale.value, {
      day: 'numeric',
      month: 'long',
      ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
    })
  }

  return { ago, dateTime, time, dayKey, dayLabel }
}
