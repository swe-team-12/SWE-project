// Attendee area catalogue: discovery, public event page, orders, ticket
// wallet, campaign landing and the sign-in screens. Keys live under the
// `attendee` namespace.

export const en = {
  attendee: {
    browseEvents: "Browse events",
    contactSupport: "Contact support",
    needHelp: "Need help?",
    attendeeLine: "Attendee: {{name}}",
    seatLine: "Seat: {{seat}}",
    coverImageLabel: "Cover image for {{title}}",
    calendarProvider: {
      google: "Google Calendar",
      outlook: "Outlook.com",
      office365: "Office 365",
      yahoo: "Yahoo Calendar",
    },
    calendarUnavailable: {
      event_cancelled:
        "The event was cancelled, so it cannot be added to a calendar.",
      ticket_not_valid:
        "This ticket is no longer valid, so it cannot be added to a calendar.",
      order_closed:
        "This order was refunded or cancelled, so it cannot be added to a calendar.",
      other: "A calendar entry is not available right now.",
    },
    discover: {
      resultCount: "Events found: {{count}}",
      noEvents: "There are no upcoming public events yet. Check back soon.",
      noMatches:
        "No events match these filters. Try another search or clear the dates.",
      datePlaceholder: "MM/DD/YYYY",
      invalidDate: "Enter a real date, for example 11/14/2026",
    },
    event: {
      stateTitle: {
        cancelled: "Event cancelled",
        suspended: "Event suspended",
        not_published: "Event not available",
        registration_not_open: "Registration not open yet",
        registration_closed: "Registration closed",
      },
      cancelReason: "Reason given by the organizer: {{reason}}",
      cancelledHelp:
        "If you hold tickets for this event, open your orders to see their refund status.",
      endsAt: "Ends {{date}}",
      seatsLeft: "Seats left: {{count}}",
      salesEndAt: "Sales close {{date}}",
      paidSuspended:
        "Paid ticket sales for this event are suspended. Free tickets can still be reserved.",
      salesClosed: "Tickets cannot be reserved right now.",
      allSoldOut: "All tickets are sold out.",
      nothingOnSale: "No tickets are on sale right now.",
      contactTitle: "Questions about this event?",
      contactHelp:
        "Send the organizer a message about access, seating or anything else. Replies arrive in Support.",
      contactOrganizer: "Contact the organizer",
    },
    report: {
      title: "Report this event",
      help: "Tell the platform team if this event looks fraudulent, misleading or unsafe. The organizer does not see who reported it.",
      signIn: "Sign in to report this event",
      open: "Report this event",
      category: "What is wrong?",
      categories: {
        fraud: "Fraud or scam",
        misleading_information: "Misleading information",
        inappropriate_content: "Inappropriate content",
        safety: "Safety concern",
        spam: "Spam",
        other: "Something else",
      },
      details: "Details (optional)",
      detailsRequired: "Details (required for “Something else”)",
      detailsTooShort: "Describe the problem in at least {{count}} characters",
      submit: "Continue",
      confirmTitle: "Send this report?",
      confirmBody:
        "The report goes to the platform administrators for review. You can have one open report per event.",
      confirm: "Send report",
      submitted:
        "Thank you. Your report was sent to the platform team for review.",
      alreadyOpen:
        "You have already reported this event. The platform team is reviewing it.",
    },
    orders: {
      unknownEvent: "Event",
      placedOn: "Placed {{date}}",
      viewOrder: "View order",
      viewOrderLabel: "View order {{number}}",
      eventCancelled: "The event was cancelled by the organizer.",
      closedTitle: {
        refunded: "Order refunded",
        cancelled: "Order cancelled",
      },
      closedNote: {
        refunded:
          "This order was refunded and its tickets are no longer valid for entry.",
        cancelled:
          "This order was cancelled and its tickets are no longer valid for entry.",
      },
      notFound: "Order not found",
      backToOrders: "All orders",
      detailKicker: "Order details",
      confirmationKicker: "Order confirmation",
      orderNumber: "Order {{number}}",
      confirmedTitle: "You are going",
      confirmedBody:
        "Your order is confirmed. Tickets issued: {{count}}. They are in your wallet and were sent to your email.",
      eventSection: "Event",
      itemsSection: "Tickets in this order: {{count}}",
      noItems: "This order has no tickets.",
      paymentSection: "Payment",
      noPayments: "No payment has been recorded for this order yet.",
      freeNoPayment: "This order is free — no payment was needed.",
      refundsTitle: "Refunds",
      refundReason: "Reason: {{reason}}",
      totalsSection: "Totals",
      processingFee: "Processing fee (included)",
      processingFeeHelp:
        "Simulated processor deduction. It is already part of the ticket price and is not added to your total.",
      total: "Total",
      refunded: "Refunded",
      ticketsSection: "Your tickets",
      ticketsHelp: "QR codes and printable PDF tickets are in your wallet.",
      viewTickets: "Open my tickets",
      supportHelp:
        "Ask about this order, a refund or event access. The request is linked to this order.",
    },
    tickets: {
      when: "Date and time",
      where: "Venue",
      ticketType: "Ticket type",
      attendee: "Attendee",
      seat: "Seat",
      order: "Order",
      checkedInAt: "Checked in",
      qrLabel: "Admission QR code for ticket {{code}}",
      qrFailed: "The QR code could not be loaded.",
      inactiveTitle: {
        checked_in: "Already used for entry",
        refunded: "Ticket refunded",
        cancelled: "Ticket cancelled",
        other: "Ticket not valid",
      },
      inactiveBody: {
        checked_in:
          "This ticket was scanned at the entrance and cannot be used again.",
        refunded:
          "The ticket was refunded, so its QR code and PDF are no longer available.",
        cancelled:
          "The ticket was cancelled, so its QR code and PDF are no longer available.",
        other: "The QR code and PDF are not available for this ticket.",
      },
    },
    campaign: {
      unavailable: "This campaign link is not available.",
      inactiveTitle: "This promotion is not active",
      state: {
        disabled: "The organizer has switched this promotion off.",
        not_started: "This promotion has not started yet. It begins on {{date}}.",
        expired: "This promotion ended on {{date}}.",
        exhausted: "All redemptions of this promotion have been used.",
      },
      eventStillOpen:
        "You can still open “{{title}}” and buy tickets at the regular price.",
      eventStillOpenGeneric:
        "You can still open the event and buy tickets at the regular price.",
    },
    auth: {
      signInFailed: "Sign-in failed. Check your details and try again.",
      registrationFailed: "Registration failed. Try again.",
      nameTooShort: "Enter at least 2 characters",
      passwordTooShort: "The password has at least 10 characters",
      noVerificationEmail: "Didn't get the verification email?",
      resendHelp:
        "Enter the address you registered with and we will send a new link.",
      resendVerification: "Resend verification email",
      resendQueued:
        "If an unverified account uses this address, a new verification link is on its way.",
      openDemoVerification: "Demo shortcut: open the verification link now",
      checkInboxTitle: "Check your inbox",
      checkInboxBody:
        "We sent a verification link to {{email}}. Open it to activate your account, then sign in.",
      alreadyVerified: "Your email address is already verified.",
      resetRequested:
        "If an account uses this address, a password reset link is on its way.",
      passwordUpdated: "Your password was updated. You can sign in now.",
      resetMissingToken:
        "This reset link is missing its token. Request a new link.",
    },
    ux: {
      back: "Back",
      greeting: "Account",
      welcomeGuest: "Welcome to BiletFlow",
      guestTagline: "Find your next event",
      filters: "Date filters",
      clearDates: "Clear dates",
      dateChips: "Pick a day",
      anyDate: "Any",
      allDates: "dates",
      anyDateLabel: "Show events on any date",
      today: "Today",
      dayChipLabel: "Show events on {{date}}",
      categories: "Categories",
      allCategories: "All",
      durationDaysHours: "{{days}} d {{hours}} h",
      durationDays: "{{days}} d",
      durationHoursMinutes: "{{hours}} h {{minutes}} min",
      durationHours: "{{hours}} h",
      durationMinutes: "{{minutes}} min",
      ticketClasses: "Ticket classes",
      ticketClassesHelp: "Compare the options, then choose your tickets.",
      notOnSale: "Not on sale",
      about: "About this event",
      section: "Section",
      row: "Row",
      bookingReference: "Booking reference",
      ticketCode: "Ticket code",
      ticketCount: "Tickets: {{count}}",
    },
  },
  status: {
    pending: "Pending",
  },
};

export const ru = {
  attendee: {
    browseEvents: "Смотреть афишу",
    contactSupport: "Написать в поддержку",
    needHelp: "Нужна помощь?",
    attendeeLine: "Посетитель: {{name}}",
    seatLine: "Место: {{seat}}",
    coverImageLabel: "Обложка события «{{title}}»",
    calendarProvider: {
      google: "Google Календарь",
      outlook: "Outlook.com",
      office365: "Office 365",
      yahoo: "Yahoo Календарь",
    },
    calendarUnavailable: {
      event_cancelled: "Событие отменено, поэтому добавить его в календарь нельзя.",
      ticket_not_valid:
        "Билет больше не действителен, поэтому добавить его в календарь нельзя.",
      order_closed:
        "Заказ возвращён или отменён, поэтому добавить его в календарь нельзя.",
      other: "Запись для календаря сейчас недоступна.",
    },
    discover: {
      resultCount: "Найдено событий: {{count}}",
      noEvents: "Публичных событий пока нет. Загляните позже.",
      noMatches:
        "По этим фильтрам ничего не найдено. Измените запрос или очистите даты.",
      datePlaceholder: "ДД.ММ.ГГГГ",
      invalidDate: "Укажите существующую дату, например 14.11.2026",
    },
    event: {
      stateTitle: {
        cancelled: "Событие отменено",
        suspended: "Событие приостановлено",
        not_published: "Событие недоступно",
        registration_not_open: "Регистрация ещё не открыта",
        registration_closed: "Регистрация закрыта",
      },
      cancelReason: "Причина, указанная организатором: {{reason}}",
      cancelledHelp:
        "Если у вас есть билеты на это событие, откройте свои заказы, чтобы увидеть статус возврата.",
      endsAt: "Окончание: {{date}}",
      seatsLeft: "Осталось мест: {{count}}",
      salesEndAt: "Продажи закрываются {{date}}",
      paidSuspended:
        "Продажа платных билетов на это событие приостановлена. Бесплатные билеты по-прежнему можно забронировать.",
      salesClosed: "Сейчас забронировать билеты нельзя.",
      allSoldOut: "Все билеты распроданы.",
      nothingOnSale: "Сейчас билеты не продаются.",
      contactTitle: "Есть вопросы о событии?",
      contactHelp:
        "Напишите организатору о доступе, местах или о чём-то ещё. Ответы приходят в раздел «Поддержка».",
      contactOrganizer: "Написать организатору",
    },
    report: {
      title: "Пожаловаться на событие",
      help: "Сообщите команде платформы, если событие похоже на мошенничество, вводит в заблуждение или небезопасно. Организатор не видит, кто отправил жалобу.",
      signIn: "Войдите, чтобы пожаловаться на событие",
      open: "Пожаловаться на событие",
      category: "Что не так?",
      categories: {
        fraud: "Мошенничество или обман",
        misleading_information: "Недостоверная информация",
        inappropriate_content: "Неприемлемое содержание",
        safety: "Угроза безопасности",
        spam: "Спам",
        other: "Другое",
      },
      details: "Подробности (необязательно)",
      detailsRequired: "Подробности (обязательно для «Другое»)",
      detailsTooShort: "Опишите проблему — не менее {{count}} символов",
      submit: "Продолжить",
      confirmTitle: "Отправить жалобу?",
      confirmBody:
        "Жалоба попадёт на рассмотрение администраторам платформы. На одно событие можно иметь одну открытую жалобу.",
      confirm: "Отправить жалобу",
      submitted: "Спасибо. Жалоба отправлена команде платформы на рассмотрение.",
      alreadyOpen:
        "Вы уже пожаловались на это событие. Команда платформы рассматривает жалобу.",
    },
    orders: {
      unknownEvent: "Событие",
      placedOn: "Оформлен {{date}}",
      viewOrder: "Открыть заказ",
      viewOrderLabel: "Открыть заказ {{number}}",
      eventCancelled: "Организатор отменил событие.",
      closedTitle: {
        refunded: "Заказ возвращён",
        cancelled: "Заказ отменён",
      },
      closedNote: {
        refunded:
          "По этому заказу оформлен возврат, билеты больше не действительны для входа.",
        cancelled:
          "Этот заказ отменён, билеты больше не действительны для входа.",
      },
      notFound: "Заказ не найден",
      backToOrders: "Все заказы",
      detailKicker: "Детали заказа",
      confirmationKicker: "Подтверждение заказа",
      orderNumber: "Заказ {{number}}",
      confirmedTitle: "Вы идёте",
      confirmedBody:
        "Заказ подтверждён. Выпущено билетов: {{count}}. Они в вашем кошельке и отправлены на email.",
      eventSection: "Событие",
      itemsSection: "Билетов в заказе: {{count}}",
      noItems: "В этом заказе нет билетов.",
      paymentSection: "Оплата",
      noPayments: "По этому заказу пока нет записей об оплате.",
      freeNoPayment: "Заказ бесплатный — оплата не потребовалась.",
      refundsTitle: "Возвраты",
      refundReason: "Причина: {{reason}}",
      totalsSection: "Суммы",
      processingFee: "Комиссия за обработку (включена)",
      processingFeeHelp:
        "Имитация комиссии платёжного сервиса. Она уже входит в цену билета и не добавляется к итогу.",
      total: "Итого",
      refunded: "Возвращено",
      ticketsSection: "Ваши билеты",
      ticketsHelp: "QR-коды и PDF-билеты для печати лежат в вашем кошельке.",
      viewTickets: "Открыть мои билеты",
      supportHelp:
        "Спросите о заказе, возврате или доступе на событие. Обращение будет привязано к этому заказу.",
    },
    tickets: {
      when: "Дата и время",
      where: "Площадка",
      ticketType: "Тип билета",
      attendee: "Посетитель",
      seat: "Место",
      order: "Заказ",
      checkedInAt: "Вход отмечен",
      qrLabel: "QR-код для входа, билет {{code}}",
      qrFailed: "Не удалось загрузить QR-код.",
      inactiveTitle: {
        checked_in: "Билет уже использован",
        refunded: "Билет возвращён",
        cancelled: "Билет отменён",
        other: "Билет недействителен",
      },
      inactiveBody: {
        checked_in:
          "Билет отсканирован на входе и повторно использовать его нельзя.",
        refunded:
          "По билету оформлен возврат, поэтому QR-код и PDF больше недоступны.",
        cancelled: "Билет отменён, поэтому QR-код и PDF больше недоступны.",
        other: "QR-код и PDF для этого билета недоступны.",
      },
    },
    campaign: {
      unavailable: "Эта ссылка акции недоступна.",
      inactiveTitle: "Акция сейчас не действует",
      state: {
        disabled: "Организатор отключил эту акцию.",
        not_started: "Акция ещё не началась. Начало: {{date}}.",
        expired: "Акция завершилась {{date}}.",
        exhausted: "Все применения этой акции уже использованы.",
      },
      eventStillOpen:
        "Вы по-прежнему можете открыть «{{title}}» и купить билеты по обычной цене.",
      eventStillOpenGeneric:
        "Вы по-прежнему можете открыть событие и купить билеты по обычной цене.",
    },
    auth: {
      signInFailed: "Не удалось войти. Проверьте данные и попробуйте снова.",
      registrationFailed: "Не удалось зарегистрироваться. Попробуйте снова.",
      nameTooShort: "Введите не менее 2 символов",
      passwordTooShort: "В пароле не менее 10 символов",
      noVerificationEmail: "Не пришло письмо с подтверждением?",
      resendHelp:
        "Укажите адрес, с которым вы регистрировались, и мы отправим новую ссылку.",
      resendVerification: "Отправить письмо ещё раз",
      resendQueued:
        "Если на этот адрес зарегистрирован неподтверждённый аккаунт, новая ссылка уже отправлена.",
      openDemoVerification: "Демо: открыть ссылку подтверждения сейчас",
      checkInboxTitle: "Проверьте почту",
      checkInboxBody:
        "Мы отправили ссылку для подтверждения на {{email}}. Откройте её, чтобы активировать аккаунт, и затем войдите.",
      alreadyVerified: "Ваш email уже подтверждён.",
      resetRequested:
        "Если этот адрес привязан к аккаунту, ссылка для сброса пароля уже отправлена.",
      passwordUpdated: "Пароль обновлён. Теперь можно войти.",
      resetMissingToken:
        "В ссылке для сброса нет токена. Запросите новую ссылку.",
    },
    ux: {
      back: "Назад",
      greeting: "Аккаунт",
      welcomeGuest: "Добро пожаловать в BiletFlow",
      guestTagline: "Найдите своё следующее событие",
      filters: "Фильтр по датам",
      clearDates: "Сбросить даты",
      dateChips: "Выберите день",
      anyDate: "Любые",
      allDates: "даты",
      anyDateLabel: "Показать события на любые даты",
      today: "Сегодня",
      dayChipLabel: "Показать события на {{date}}",
      categories: "Категории",
      allCategories: "Все",
      durationDaysHours: "{{days}} д {{hours}} ч",
      durationDays: "{{days}} д",
      durationHoursMinutes: "{{hours}} ч {{minutes}} мин",
      durationHours: "{{hours}} ч",
      durationMinutes: "{{minutes}} мин",
      ticketClasses: "Типы билетов",
      ticketClassesHelp: "Сравните варианты и выберите билеты.",
      notOnSale: "Не в продаже",
      about: "О событии",
      section: "Сектор",
      row: "Ряд",
      bookingReference: "Номер бронирования",
      ticketCode: "Код билета",
      ticketCount: "Билетов: {{count}}",
    },
  },
  status: {
    pending: "Ожидает",
  },
};

export const kk = {
  attendee: {
    browseEvents: "Афишаны қарау",
    contactSupport: "Қолдау қызметіне жазу",
    needHelp: "Көмек керек пе?",
    attendeeLine: "Қатысушы: {{name}}",
    seatLine: "Орын: {{seat}}",
    coverImageLabel: "«{{title}}» іс-шарасының мұқабасы",
    calendarProvider: {
      google: "Google Күнтізбе",
      outlook: "Outlook.com",
      office365: "Office 365",
      yahoo: "Yahoo Күнтізбе",
    },
    calendarUnavailable: {
      event_cancelled:
        "Іс-шара тоқтатылды, сондықтан оны күнтізбеге қосу мүмкін емес.",
      ticket_not_valid:
        "Билет енді жарамсыз, сондықтан оны күнтізбеге қосу мүмкін емес.",
      order_closed:
        "Тапсырыс қайтарылған немесе тоқтатылған, сондықтан оны күнтізбеге қосу мүмкін емес.",
      other: "Күнтізбе жазбасы қазір қолжетімсіз.",
    },
    discover: {
      resultCount: "Табылған іс-шаралар: {{count}}",
      noEvents: "Әзірге ашық іс-шаралар жоқ. Кейінірек қайта қараңыз.",
      noMatches:
        "Бұл сүзгілер бойынша ештеңе табылмады. Сұранысты өзгертіңіз немесе күндерді тазалаңыз.",
      datePlaceholder: "КК.АА.ЖЖЖЖ",
      invalidDate: "Нақты күнді енгізіңіз, мысалы 14.11.2026",
    },
    event: {
      stateTitle: {
        cancelled: "Іс-шара тоқтатылды",
        suspended: "Іс-шара уақытша тоқтатылған",
        not_published: "Іс-шара қолжетімсіз",
        registration_not_open: "Тіркеу әлі ашылған жоқ",
        registration_closed: "Тіркеу жабылды",
      },
      cancelReason: "Ұйымдастырушы көрсеткен себеп: {{reason}}",
      cancelledHelp:
        "Осы іс-шараға билетіңіз болса, қайтару күйін көру үшін тапсырыстарыңызды ашыңыз.",
      endsAt: "Аяқталуы: {{date}}",
      seatsLeft: "Қалған орын саны: {{count}}",
      salesEndAt: "Сатылым {{date}} жабылады",
      paidSuspended:
        "Бұл іс-шараға ақылы билеттер сатылымы уақытша тоқтатылған. Тегін билеттерді әлі де брондауға болады.",
      salesClosed: "Қазір билет брондау мүмкін емес.",
      allSoldOut: "Барлық билет сатылып кетті.",
      nothingOnSale: "Қазір сатылымда билет жоқ.",
      contactTitle: "Іс-шара туралы сұрағыңыз бар ма?",
      contactHelp:
        "Ұйымдастырушыға кіру, орындар немесе басқа мәселе жөнінде жазыңыз. Жауаптар «Қолдау» бөліміне келеді.",
      contactOrganizer: "Ұйымдастырушыға жазу",
    },
    report: {
      title: "Іс-шараға шағымдану",
      help: "Іс-шара алаяқтыққа ұқсаса, жаңылыстырса немесе қауіпті болса, платформа командасына хабарлаңыз. Ұйымдастырушы шағымды кім жібергенін көрмейді.",
      signIn: "Шағымдану үшін кіріңіз",
      open: "Іс-шараға шағымдану",
      category: "Не дұрыс емес?",
      categories: {
        fraud: "Алаяқтық немесе алдау",
        misleading_information: "Жаңылыстыратын ақпарат",
        inappropriate_content: "Орынсыз мазмұн",
        safety: "Қауіпсіздікке қатер",
        spam: "Спам",
        other: "Басқа",
      },
      details: "Толығырақ (міндетті емес)",
      detailsRequired: "Толығырақ («Басқа» үшін міндетті)",
      detailsTooShort: "Мәселені кемінде {{count}} таңбамен сипаттаңыз",
      submit: "Жалғастыру",
      confirmTitle: "Шағымды жібересіз бе?",
      confirmBody:
        "Шағымды платформа әкімшілері қарайды. Бір іс-шараға бір ғана ашық шағым жіберуге болады.",
      confirm: "Шағымды жіберу",
      submitted: "Рақмет. Шағымыңыз платформа командасына қарауға жіберілді.",
      alreadyOpen:
        "Сіз бұл іс-шараға шағымданып қойғансыз. Платформа командасы оны қарап жатыр.",
    },
    orders: {
      unknownEvent: "Іс-шара",
      placedOn: "Рәсімделген уақыты: {{date}}",
      viewOrder: "Тапсырысты ашу",
      viewOrderLabel: "{{number}} тапсырысын ашу",
      eventCancelled: "Ұйымдастырушы іс-шараны тоқтатты.",
      closedTitle: {
        refunded: "Тапсырыс қайтарылды",
        cancelled: "Тапсырыс тоқтатылды",
      },
      closedNote: {
        refunded:
          "Бұл тапсырыс бойынша ақша қайтарылды, билеттер кіруге енді жарамсыз.",
        cancelled: "Бұл тапсырыс тоқтатылды, билеттер кіруге енді жарамсыз.",
      },
      notFound: "Тапсырыс табылмады",
      backToOrders: "Барлық тапсырыс",
      detailKicker: "Тапсырыс мәліметтері",
      confirmationKicker: "Тапсырыс растауы",
      orderNumber: "Тапсырыс {{number}}",
      confirmedTitle: "Сіз барасыз",
      confirmedBody:
        "Тапсырыс расталды. Шығарылған билет саны: {{count}}. Олар әмияныңызда және email мекенжайыңызға жіберілді.",
      eventSection: "Іс-шара",
      itemsSection: "Тапсырыстағы билет саны: {{count}}",
      noItems: "Бұл тапсырыста билет жоқ.",
      paymentSection: "Төлем",
      noPayments: "Бұл тапсырыс бойынша әзірге төлем жазбасы жоқ.",
      freeNoPayment: "Тапсырыс тегін — төлем қажет болмады.",
      refundsTitle: "Қайтарымдар",
      refundReason: "Себебі: {{reason}}",
      totalsSection: "Сомалар",
      processingFee: "Өңдеу комиссиясы (бағаға кіреді)",
      processingFeeHelp:
        "Төлем сервисі комиссиясының имитациясы. Ол билет бағасына кіреді және қорытынды сомаға қосылмайды.",
      total: "Барлығы",
      refunded: "Қайтарылды",
      ticketsSection: "Билеттеріңіз",
      ticketsHelp: "QR кодтар мен басып шығаруға арналған PDF билеттер әмияныңызда.",
      viewTickets: "Билеттерімді ашу",
      supportHelp:
        "Тапсырыс, қайтару немесе іс-шараға кіру туралы сұраңыз. Өтініш осы тапсырысқа байланыстырылады.",
    },
    tickets: {
      when: "Күні мен уақыты",
      where: "Өтетін орны",
      ticketType: "Билет түрі",
      attendee: "Қатысушы",
      seat: "Орын",
      order: "Тапсырыс",
      checkedInAt: "Кіру белгіленді",
      qrLabel: "Кіруге арналған QR код, билет {{code}}",
      qrFailed: "QR кодты жүктеу мүмкін болмады.",
      inactiveTitle: {
        checked_in: "Билет қолданылып қойған",
        refunded: "Билет қайтарылды",
        cancelled: "Билет тоқтатылды",
        other: "Билет жарамсыз",
      },
      inactiveBody: {
        checked_in:
          "Билет кіреберісте сканерленді, оны қайта қолдану мүмкін емес.",
        refunded:
          "Билет бойынша ақша қайтарылды, сондықтан QR код пен PDF енді қолжетімсіз.",
        cancelled: "Билет тоқтатылды, сондықтан QR код пен PDF енді қолжетімсіз.",
        other: "Бұл билет үшін QR код пен PDF қолжетімсіз.",
      },
    },
    campaign: {
      unavailable: "Бұл акция сілтемесі қолжетімсіз.",
      inactiveTitle: "Акция қазір жарамсыз",
      state: {
        disabled: "Ұйымдастырушы бұл акцияны өшіріп қойған.",
        not_started: "Акция әлі басталған жоқ. Басталуы: {{date}}.",
        expired: "Акция {{date}} аяқталды.",
        exhausted: "Бұл акцияның барлық қолданылуы таусылды.",
      },
      eventStillOpen:
        "«{{title}}» іс-шарасын ашып, билетті әдеттегі бағамен сатып ала аласыз.",
      eventStillOpenGeneric:
        "Іс-шараны ашып, билетті әдеттегі бағамен сатып ала аласыз.",
    },
    auth: {
      signInFailed: "Кіру мүмкін болмады. Деректерді тексеріп, қайталап көріңіз.",
      registrationFailed: "Тіркелу мүмкін болмады. Қайталап көріңіз.",
      nameTooShort: "Кемінде 2 таңба енгізіңіз",
      passwordTooShort: "Құпиясөзде кемінде 10 таңба болады",
      noVerificationEmail: "Растау хаты келмеді ме?",
      resendHelp:
        "Тіркелген мекенжайыңызды көрсетіңіз, біз жаңа сілтеме жібереміз.",
      resendVerification: "Растау хатын қайта жіберу",
      resendQueued:
        "Егер бұл мекенжайға расталмаған аккаунт тіркелген болса, жаңа растау сілтемесі жіберілді.",
      openDemoVerification: "Демо: растау сілтемесін қазір ашу",
      checkInboxTitle: "Поштаңызды тексеріңіз",
      checkInboxBody:
        "Растау сілтемесін {{email}} мекенжайына жібердік. Аккаунтты іске қосу үшін оны ашыңыз, содан кейін кіріңіз.",
      alreadyVerified: "Email мекенжайыңыз расталған.",
      resetRequested:
        "Егер бұл мекенжай аккаунтқа байланысты болса, құпиясөзді қалпына келтіру сілтемесі жіберілді.",
      passwordUpdated: "Құпиясөз жаңартылды. Енді кіре аласыз.",
      resetMissingToken:
        "Қалпына келтіру сілтемесінде токен жоқ. Жаңа сілтеме сұраңыз.",
    },
    ux: {
      back: "Артқа",
      greeting: "Аккаунт",
      welcomeGuest: "BiletFlow-ға қош келдіңіз",
      guestTagline: "Келесі іс-шараңызды табыңыз",
      filters: "Күн бойынша сүзгі",
      clearDates: "Күндерді тазарту",
      dateChips: "Күнді таңдаңыз",
      anyDate: "Кез келген",
      allDates: "күн",
      anyDateLabel: "Кез келген күнгі іс-шараларды көрсету",
      today: "Бүгін",
      dayChipLabel: "{{date}} күнгі іс-шараларды көрсету",
      categories: "Санаттар",
      allCategories: "Барлығы",
      durationDaysHours: "{{days}} күн {{hours}} сағ",
      durationDays: "{{days}} күн",
      durationHoursMinutes: "{{hours}} сағ {{minutes}} мин",
      durationHours: "{{hours}} сағ",
      durationMinutes: "{{minutes}} мин",
      ticketClasses: "Билет түрлері",
      ticketClassesHelp: "Нұсқаларды салыстырып, билеттерді таңдаңыз.",
      notOnSale: "Сатылымда жоқ",
      about: "Іс-шара туралы",
      section: "Сектор",
      row: "Қатар",
      bookingReference: "Брондау нөмірі",
      ticketCode: "Билет коды",
      ticketCount: "Билеттер саны: {{count}}",
    },
  },
  status: {
    pending: "Күтілуде",
  },
};
