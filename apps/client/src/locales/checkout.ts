// Checkout area catalogue: ticket and seat selection, reservation hold,
// simulated payment. Keys live under the `checkout` namespace.

export const en = {
  checkout: {
    title: "Checkout",
    backToEvent: "Back to the event",
    holdRemaining: "Reserved for {{time}}",
    holdRemainingLabel:
      "Reservation time left: {{minutes}} min {{seconds}} s",
    holdUntil: "Held until {{time}}",
    simulationTitle: "Academic payment simulation",
    simulationHelp:
      "No real money moves and no card details are asked for. Choose the outcome you want to demonstrate.",
    release: "Cancel checkout and release tickets",
    releaseConfirmTitle: "Cancel this checkout?",
    releaseConfirmBody:
      "Your reserved tickets and seats will be released right away and other people will be able to take them.",
    releaseConfirm: "Yes, release them",
    keepReservation: "Keep my reservation",
    released:
      "Checkout cancelled. The tickets were released — you can start again whenever you like.",
    releaseFailed: "The reservation could not be released. Try again.",
    verifyTitle: "Confirm your email first",
    verifyBody:
      "Tickets can only be reserved from a verified account. We sent a link to {{email}}.",
    verifyRefresh: "I have verified my email",
    unavailableTitle: "Tickets are not available",
    eventState: {
      cancelled: "This event has been cancelled. Tickets are no longer available.",
      suspended: "This event is suspended. Tickets cannot be reserved for now.",
      not_published: "This event is not open to the public right now.",
      registration_not_open: "Registration has not opened yet. It opens on {{date}}.",
      registration_closed: "Registration closed on {{date}}.",
    },
    chooseSeats: "Choose your seats",
    chooseTickets: "Choose your tickets",
    maxPerOrder: "Up to {{count}} per order",
    salesState: {
      not_started: "Sales start on {{date}}",
      ended: "Sales have ended",
      paid_suspended: "Paid sales are suspended",
      paid_not_activated: "Paid sales are not open yet",
    },
    selectedSeats: "Selected seats",
    seatLabel: "Section {{section}}, row {{row}}, seat {{number}}",
    accessibleSeat: "accessible",
    removeSeat: "Remove {{seat}}",
    remove: "Remove",
    ticketTypeForSeat: "Ticket type for {{seat}}",
    noTicketTypes: "No tickets are offered for this event yet.",
    decrease: "One fewer: {{name}}",
    increase: "One more: {{name}}",
    quantityOf: "{{name}}: {{count}} selected",
    limitReached: "Limit reached",
    buyerHelp:
      "The order confirmation is sent to your account email. Each ticket carries the name of the person attending.",
    sameForAll: "Use these details for every ticket",
    ticketNumber: "Ticket {{number}}",
    attendeeNameFor: "Attendee name, ticket {{number}}",
    attendeeEmailFor: "Attendee email, ticket {{number}}",
    nameRequired: "Enter at least 2 characters",
    attendeeDetailsRequired:
      "Enter a name and a valid email for every ticket to continue.",
    orderSummary: "Order summary",
    summaryRestored:
      "Your reservation is still active. The totals below are final.",
    summaryEmptySeats: "Choose seats on the map or in the list to see the total.",
    summaryEmpty: "Choose tickets to see the total.",
    estimatedSubtotal: "Estimated subtotal",
    totalsAfterReserve:
      "Discounts and the final total are calculated when the tickets are reserved.",
    startOver: "Start over",
    paymentFailed:
      "The simulated payment was declined and the reservation was released. Your selection is kept — reserve it again to retry.",
    paymentTimedOut:
      "The simulated payment timed out and the reservation was released. Your selection is kept — reserve it again to retry.",
    seatError: {
      no_ticket_type: "No ticket type is available for this seat.",
      not_on_sale: "{{typeName}} tickets are not on sale right now.",
      type_limit: "You can take at most {{limit}} {{typeName}} tickets per order.",
      order_limit: "One order can hold at most {{limit}} tickets.",
    },
    accessibleSeatLegend: "Accessible seat (outer ring)",
    seatListHelp:
      "Seats are grouped by section. Each one states its price and status.",
    seatMapHelp:
      "Tap a seat to select it, tap again to deselect. With a keyboard, use the arrow keys and press Enter or Space. A text list is available too.",
    seatSection: "Section {{section}}",
    seatsSelectedCount: "Seats selected: {{count}}",
    allSections: "All sections",
    sectionAvailability: "{{available}} of {{total}} seats available",
    sectionTabs: "Seating sections",
    barTickets: "Tickets: {{count}}",
  },
};

export const ru = {
  checkout: {
    title: "Оформление заказа",
    backToEvent: "Назад к событию",
    holdRemaining: "Бронь действует ещё {{time}}",
    holdRemainingLabel:
      "До конца брони осталось {{minutes}} мин {{seconds}} с",
    holdUntil: "Бронь до {{time}}",
    simulationTitle: "Учебная имитация оплаты",
    simulationHelp:
      "Настоящие деньги не списываются, данные карты не запрашиваются. Выберите исход, который хотите показать.",
    release: "Отменить оформление и освободить билеты",
    releaseConfirmTitle: "Отменить оформление?",
    releaseConfirmBody:
      "Забронированные билеты и места сразу освободятся, и их смогут занять другие покупатели.",
    releaseConfirm: "Да, освободить",
    keepReservation: "Оставить бронь",
    released:
      "Оформление отменено. Билеты освобождены — можно начать заново в любой момент.",
    releaseFailed: "Не удалось освободить бронь. Попробуйте ещё раз.",
    verifyTitle: "Сначала подтвердите email",
    verifyBody:
      "Бронировать билеты можно только с подтверждённым аккаунтом. Мы отправили ссылку на {{email}}.",
    verifyRefresh: "Я подтвердил(а) email",
    unavailableTitle: "Билеты недоступны",
    eventState: {
      cancelled: "Событие отменено. Билеты больше недоступны.",
      suspended: "Событие приостановлено. Бронирование временно недоступно.",
      not_published: "Сейчас это событие закрыто для публики.",
      registration_not_open: "Регистрация ещё не открылась. Начало: {{date}}.",
      registration_closed: "Регистрация закрыта: {{date}}.",
    },
    chooseSeats: "Выберите места",
    chooseTickets: "Выберите билеты",
    maxPerOrder: "Не более {{count}} в одном заказе",
    salesState: {
      not_started: "Продажа начнётся {{date}}",
      ended: "Продажа завершена",
      paid_suspended: "Платные продажи приостановлены",
      paid_not_activated: "Платные продажи ещё не открыты",
    },
    selectedSeats: "Выбранные места",
    seatLabel: "Сектор {{section}}, ряд {{row}}, место {{number}}",
    accessibleSeat: "доступная среда",
    removeSeat: "Убрать: {{seat}}",
    remove: "Убрать",
    ticketTypeForSeat: "Тип билета для места: {{seat}}",
    noTicketTypes: "Для этого события пока нет билетов.",
    decrease: "Уменьшить количество: {{name}}",
    increase: "Увеличить количество: {{name}}",
    quantityOf: "{{name}}: выбрано {{count}}",
    limitReached: "Достигнут лимит",
    buyerHelp:
      "Подтверждение заказа придёт на email вашего аккаунта. На каждом билете указывается имя посетителя.",
    sameForAll: "Использовать эти данные для всех билетов",
    ticketNumber: "Билет {{number}}",
    attendeeNameFor: "Имя посетителя, билет {{number}}",
    attendeeEmailFor: "Email посетителя, билет {{number}}",
    nameRequired: "Введите не менее 2 символов",
    attendeeDetailsRequired:
      "Чтобы продолжить, укажите имя и корректный email для каждого билета.",
    orderSummary: "Ваш заказ",
    summaryRestored: "Бронь ещё действует. Суммы ниже окончательные.",
    summaryEmptySeats:
      "Выберите места на схеме или в списке, чтобы увидеть сумму.",
    summaryEmpty: "Выберите билеты, чтобы увидеть сумму.",
    estimatedSubtotal: "Предварительная сумма",
    totalsAfterReserve:
      "Скидки и итоговая сумма рассчитываются при бронировании билетов.",
    startOver: "Начать заново",
    paymentFailed:
      "Имитация оплаты отклонена, бронь снята. Ваш выбор сохранён — забронируйте снова, чтобы повторить.",
    paymentTimedOut:
      "Время имитации оплаты истекло, бронь снята. Ваш выбор сохранён — забронируйте снова, чтобы повторить.",
    seatError: {
      no_ticket_type: "Для этого места нет подходящего типа билета.",
      not_on_sale: "Билеты «{{typeName}}» сейчас не продаются.",
      type_limit:
        "Билетов «{{typeName}}» в одном заказе может быть не больше {{limit}}.",
      order_limit: "В одном заказе может быть не больше {{limit}} билетов.",
    },
    accessibleSeatLegend: "Место доступной среды (внешнее кольцо)",
    seatListHelp:
      "Места сгруппированы по секторам. Для каждого указаны цена и статус.",
    seatMapHelp:
      "Нажмите на место, чтобы выбрать его, и ещё раз — чтобы снять выбор. С клавиатуры используйте стрелки и Enter или пробел. Доступен и текстовый список.",
    seatSection: "Сектор {{section}}",
    seatsSelectedCount: "Выбрано мест: {{count}}",
    allSections: "Все секторы",
    sectionAvailability: "Свободно {{available}} из {{total}} мест",
    sectionTabs: "Секторы зала",
    barTickets: "Билетов: {{count}}",
  },
};

export const kk = {
  checkout: {
    title: "Тапсырысты рәсімдеу",
    backToEvent: "Іс-шараға оралу",
    holdRemaining: "Бронь тағы {{time}} сақталады",
    holdRemainingLabel:
      "Броньның аяқталуына {{minutes}} мин {{seconds}} с қалды",
    holdUntil: "Бронь {{time}} дейін сақталады",
    simulationTitle: "Оқу мақсатындағы төлем имитациясы",
    simulationHelp:
      "Нақты ақша алынбайды, карта деректері сұралмайды. Көрсеткіңіз келетін нәтижені таңдаңыз.",
    release: "Рәсімдеуден бас тартып, билеттерді босату",
    releaseConfirmTitle: "Рәсімдеуден бас тартасыз ба?",
    releaseConfirmBody:
      "Брондалған билеттер мен орындар бірден босатылады, оларды басқа сатып алушылар ала алады.",
    releaseConfirm: "Иә, босату",
    keepReservation: "Броньды қалдыру",
    released:
      "Рәсімдеу тоқтатылды. Билеттер босатылды — кез келген уақытта қайта бастай аласыз.",
    releaseFailed: "Броньды босату мүмкін болмады. Қайталап көріңіз.",
    verifyTitle: "Алдымен email мекенжайыңызды растаңыз",
    verifyBody:
      "Билеттерді тек расталған аккаунтпен брондауға болады. Сілтемені {{email}} мекенжайына жібердік.",
    verifyRefresh: "Email мекенжайымды растадым",
    unavailableTitle: "Билеттер қолжетімсіз",
    eventState: {
      cancelled: "Іс-шара тоқтатылды. Билеттер енді қолжетімсіз.",
      suspended: "Іс-шара уақытша тоқтатылған. Қазір брондау мүмкін емес.",
      not_published: "Бұл іс-шара қазір көпшілікке жабық.",
      registration_not_open: "Тіркеу әлі ашылған жоқ. Ашылатын уақыты: {{date}}.",
      registration_closed: "Тіркеу жабылды: {{date}}.",
    },
    chooseSeats: "Орындарды таңдаңыз",
    chooseTickets: "Билеттерді таңдаңыз",
    maxPerOrder: "Бір тапсырыста ең көбі {{count}}",
    salesState: {
      not_started: "Сатылым {{date}} басталады",
      ended: "Сатылым аяқталды",
      paid_suspended: "Ақылы сатылым уақытша тоқтатылған",
      paid_not_activated: "Ақылы сатылым әлі ашылған жоқ",
    },
    selectedSeats: "Таңдалған орындар",
    seatLabel: "{{section}} секторы, {{row}} қатары, {{number}} орны",
    accessibleSeat: "қолжетімді орта",
    removeSeat: "Алып тастау: {{seat}}",
    remove: "Алып тастау",
    ticketTypeForSeat: "Мына орынға арналған билет түрі: {{seat}}",
    noTicketTypes: "Бұл іс-шараға әзірге билет жоқ.",
    decrease: "Санын азайту: {{name}}",
    increase: "Санын көбейту: {{name}}",
    quantityOf: "{{name}}: {{count}} таңдалды",
    limitReached: "Шекке жетті",
    buyerHelp:
      "Тапсырыс растауы аккаунтыңыздың email мекенжайына жіберіледі. Әр билетте қатысушының аты көрсетіледі.",
    sameForAll: "Осы деректерді барлық билетке қолдану",
    ticketNumber: "{{number}}-билет",
    attendeeNameFor: "Қатысушының аты, {{number}}-билет",
    attendeeEmailFor: "Қатысушының email мекенжайы, {{number}}-билет",
    nameRequired: "Кемінде 2 таңба енгізіңіз",
    attendeeDetailsRequired:
      "Жалғастыру үшін әр билетке ат пен дұрыс email көрсетіңіз.",
    orderSummary: "Тапсырысыңыз",
    summaryRestored: "Бронь әлі күшінде. Төмендегі сомалар түпкілікті.",
    summaryEmptySeats:
      "Соманы көру үшін сызбадан немесе тізімнен орын таңдаңыз.",
    summaryEmpty: "Соманы көру үшін билет таңдаңыз.",
    estimatedSubtotal: "Алдын ала сома",
    totalsAfterReserve:
      "Жеңілдіктер мен қорытынды сома билеттер брондалған кезде есептеледі.",
    startOver: "Қайта бастау",
    paymentFailed:
      "Төлем имитациясы қабылданбады, бронь алынды. Таңдауыңыз сақталды — қайталау үшін қайта брондаңыз.",
    paymentTimedOut:
      "Төлем имитациясының уақыты өтіп кетті, бронь алынды. Таңдауыңыз сақталды — қайталау үшін қайта брондаңыз.",
    seatError: {
      no_ticket_type: "Бұл орынға сәйкес билет түрі жоқ.",
      not_on_sale: "«{{typeName}}» билеттері қазір сатылмайды.",
      type_limit:
        "Бір тапсырыста «{{typeName}}» билеті {{limit}} данадан аспауы керек.",
      order_limit: "Бір тапсырыста {{limit}} билеттен артық болмауы керек.",
    },
    accessibleSeatLegend: "Қолжетімді орын (сыртқы шеңбер)",
    seatListHelp:
      "Орындар секторлар бойынша топталған. Әрқайсысының бағасы мен күйі көрсетілген.",
    seatMapHelp:
      "Орынды таңдау үшін басыңыз, таңдауды алу үшін қайта басыңыз. Пернетақтада көрсеткі пернелерін және Enter немесе бос орын пернесін қолданыңыз. Мәтіндік тізім де бар.",
    seatSection: "{{section}} секторы",
    seatsSelectedCount: "Таңдалған орын саны: {{count}}",
    allSections: "Барлық секторлар",
    sectionAvailability: "{{total}} орынның {{available}} бос",
    sectionTabs: "Зал секторлары",
    barTickets: "Билеттер саны: {{count}}",
  },
};
