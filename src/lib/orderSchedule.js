const TIME_ZONE = 'America/Montevideo'
const CUTOFF_HOUR = 18

const localParts = (value = new Date()) => new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
}).formatToParts(new Date(value)).reduce((parts, part) => {
  if (part.type !== 'literal') parts[part.type] = part.value
  return parts
}, {})

const dateKeyFromParts = (parts) => `${parts.year}-${parts.month}-${parts.day}`

export function addCalendarDays(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function montevideoDateKey(value = new Date()) {
  return dateKeyFromParts(localParts(value))
}

export function scheduledDeliveryDate(value = new Date()) {
  const parts = localParts(value)
  const afterCutoff = Number(parts.hour) > CUTOFF_HOUR
    || (Number(parts.hour) === CUTOFF_HOUR
      && (Number(parts.minute) > 0 || Number(parts.second) > 0 || Number(parts.fractionalSecond) > 0))
  return addCalendarDays(dateKeyFromParts(parts), afterCutoff ? 2 : 1)
}

export function tomorrowInMontevideo(value = new Date()) {
  return addCalendarDays(montevideoDateKey(value), 1)
}

export function productionWindow(deliveryDate) {
  return {
    startsAfterDate: addCalendarDays(deliveryDate, -2),
    endsOnDate: addCalendarDays(deliveryDate, -1),
  }
}

const shortDate = (dateKey) => new Intl.DateTimeFormat('es-UY', {
  day: 'numeric', month: 'numeric', timeZone: TIME_ZONE,
}).format(new Date(`${dateKey}T12:00:00-03:00`))

export function productionWindowLabel(deliveryDate) {
  const window = productionWindow(deliveryDate)
  return `Después de las 18:00 del ${shortDate(window.startsAfterDate)} y hasta las 18:00 del ${shortDate(window.endsOnDate)}`
}
