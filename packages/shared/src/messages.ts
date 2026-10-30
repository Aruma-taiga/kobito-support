export const planLabels = {
  light: "ライト",
  standard: "スタンダード",
  premium: "プレミアム",
  custom: "個別見積り",
} as const;

export const validationMessages = {
  required: "入力してください。",
  maxLength: "入力文字数が上限を超えています。",
  email: "メールアドレスの形式で入力してください。",
  passwordMin: "パスワードは8文字以上で入力してください。",
  passwordMax: "パスワードは128文字以内で入力してください。",
  passwordBlank: "空白だけのパスワードは使用できません。",
  invoiceRegistrationNo:
    "インボイス登録番号はTに続く13桁の数字で入力してください。",
  plan: "プランを選択してください。",
  paymentMethod: "お支払い方法を選択してください。",
  businessConsent: "事業のために利用することに同意してください。",
  termsConsent: "利用規約とプライバシーポリシーに同意してください。",
  partnerConsent: "紹介者への情報提供に同意してください。",
  applicationConditions: "申込み内容の表示を確認してください。",
  boolean: "選択内容を確認してください。",
  unknownField: "入力内容に使用できない項目があります。",
} as const;

export const webMessages = {
  genericServiceName: "サービス",
  serviceConfigLoading: "サービス情報を読み込んでいます。",
  serviceConfigError: "サービス情報を読み込めませんでした。",
  loginTitle: "ログイン",
  loginDescription: "メールアドレスとパスワードを入力してください。",
  emailLabel: "メールアドレス",
  passwordLabel: "パスワード",
  loginButton: "ログイン",
  loginSubmitting: "ログインしています…",
  loginError: "ログインできませんでした。入力内容を確認してください。",
  sessionLoading: "ログイン状態を確認しています。",
  homeTitle: "マイページ",
  profileLoading: "お客様情報を読み込んでいます。",
  profileError: "お客様情報を読み込めませんでした。",
  sessionExpiredError:
    "ログイン状態を確認できません。ログアウトして、もう一度ログインしてください。",
  retry: "再試行",
  shopNameLabel: "店舗名",
  contactNameLabel: "ご担当者",
  logout: "ログアウト",
  logoutError: "ログアウトできませんでした。もう一度お試しください。",
  configurationError: "画面の設定を確認できませんでした。",
  applicationTitle: "お申し込み",
  applicationDescription:
    "内容を入力してお申し込みください。申込み後に当社で審査します。",
  applicationProgressShop: "店舗",
  applicationProgressPlan: "プラン",
  applicationProgressPayment: "お支払い",
  applicationProgressNotes: "ご要望",
  applicationProgressConfirm: "確認",
  applicationNext: "次へ",
  applicationPrevious: "戻る",
  applicationSubmit: "申し込む",
  applicationSubmitting: "申し込みを送信しています…",
  applicationPlansLoading: "プランを読み込んでいます。",
  applicationPlansError: "プランを読み込めませんでした。",
  applicationPolicyUnavailable:
    "現在、お申し込みを受け付けていません。時間をおいてもう一度お試しください。",
  applicationPasswordHint:
    "申込内容を確認するためのアカウントを作成します。パスワードは認証サービスに送信されます。",
  applicationExistingEmailLoginGuidance:
    "このメールアドレスは登録済みです。ログインしてからお申し込みください。",
  applicationSubmitError:
    "申し込みを受け付けられませんでした。入力内容を確認して再度お試しください。",
  applicationConditionsChanged:
    "表示内容が更新されました。最新の条件を確認して、もう一度お申し込みください。",
  applicationPreviewWarning:
    "開発用プレビューです。本番の申込みではありません。",
  applicationPersonalInfoWarning:
    "患者さま・お客さまの個人情報は入力しないでください。",
  consentBusinessUse: "事業のために利用します。",
  consentTerms: "利用規約とプライバシーポリシーを確認し、同意します。",
  consentMarketing: "お知らせを受け取る（任意）",
  consentPartnerShare:
    "紹介者へ、契約・支払いに関する必要な情報が共有されることに同意します。",
  applicationPartnerConsentHint:
    "紹介者がいる場合は、紹介者への情報提供について同意が必要です。",
  applicationReceiptPendingReview:
    "お申し込みを受け付けました。現在、審査中です。",
  applicationContractNotFormed:
    "申込みの受付時点では、契約は成立していません。",
  applicationStepShop: "店舗",
  applicationStepPlan: "プラン",
  applicationStepPayment: "お支払い",
  applicationStepNotes: "ご要望",
  applicationStepConfirm: "確認",
  applicationProgressLabel: "申込みの手順",
  applicationShopHeading: "店舗情報",
  applicationPlanHeading: "プランを選ぶ",
  applicationPaymentHeading: "お支払い方法",
  applicationNotesHeading: "ご要望",
  applicationConfirmHeading: "申込み内容の確認",
  applicationConfirmDescription:
    "表示内容をご確認ください。申込み後、当社で審査します。",
  applicationContactName: "ご担当者のお名前",
  applicationPhone: "電話番号",
  applicationPlanLabel: "プラン",
  applicationPaymentMethod: "お支払い方法",
  applicationBillingName: "請求先の名称",
  applicationBillingAddress: "請求先の住所",
  applicationInvoiceRegistrationNo: "インボイス登録番号",
  applicationReferralCode: "紹介コード",
  applicationReferralInvalid:
    "紹介コードを確認できませんでした。入力内容を確認してください。",
  applicationReferralChecking: "紹介コードを確認しています。",
  applicationPartnerNamePrefix: "紹介者：",
  applicationLineDisplayName: "LINEの表示名",
  applicationFreeText: "ご要望",
  applicationRequired: "必須",
  applicationOptional: "任意",
  applicationValidationError: "入力内容を確認してください。",
  applicationLoading: "申込み情報を読み込んでいます。",
  applicationLoadError: "申込み情報を読み込めませんでした。",
  applicationUnavailableTitle: "現在、お申し込みいただけません",
  applicationUnavailableDescription:
    "必要な案内を確認できないため、申込みを受け付けていません。",
  applicationUnavailablePayment:
    "現在ご利用いただけるお支払い方法がありません。",
  applicationExistingEmail:
    "このメールアドレスは登録済みです。ログインしてからお申し込みください。",
  applicationAlreadySubmittedGuidance:
    "すでにお申し込みを受け付けている可能性があります。マイページをご確認ください。",
  applicationEmailMismatch:
    "認証したメールアドレスと申込メールアドレスが一致しません。",
  applicationLoginResume: "ログインして申込みを続ける",
  applicationSignedInEmail: "ログイン中のメールアドレス",
  applicationPlanDescription: "ご希望の月額プランを選択してください。",
  applicationNotesDescription: "紹介コードや連絡事項があれば入力してください。",
  applicationPaymentDescription:
    "お支払い方法を選択してください。今ご利用いただける方法を表示します。",
  applicationPlanPriceHint: "表示金額は税込です。",
  applicationPlanSummaryFixed:
    "{name}：月額{price}円（税込）、毎月{credits}クレジット",
  applicationCustomDescription:
    "個別の条件はお申し込みの審査後にご案内します。",
  applicationCustomPrice: "お見積り",
  applicationCustomQuoteAfterReview: "審査のあとにお見積りをご案内します。",
  applicationBankTransfer: "銀行振込",
  applicationBankTransferDescription:
    "振込先は審査後にお送りする請求書でご案内します。",
  applicationCardPayment: "クレジットカード",
  applicationKonbiniPayment: "コンビニ払い",
  applicationTermsLink: "利用規約",
  applicationPrivacyLink: "プライバシーポリシー",
  applicationDisclosureLink: "特定商取引法に基づく表記",
  applicationTermsVersion: "利用規約の版",
  applicationPrivacyVersion: "プライバシーポリシーの版",
  applicationDisclosureVersion: "特商法表記の版",
  applicationContractHeading: "お申し込みの条件",
  applicationMonthlyPrepaid: "月額料金は前払いです。",
  applicationDueDays:
    "初月分は請求書の発行から{days}日以内にお支払いください。",
  applicationContractStartsOnPayment: "初月分の入金確認で契約が成立します。",
  applicationAnchorPeriod: "請求期間は契約日を起点に計算します。",
  applicationNoRollover: "未使用のクレジットは翌月に繰り越されません。",
  applicationCancelPeriodEnd:
    "解約は契約期間の末日に適用され、日割り計算はありません。",
  applicationExtraCredit: "追加クレジットは1C {amount}円（税込）です。",
  applicationReceiptTitle: "お申し込みを受け付けました",
  applicationReceiptDescription: "入力内容を確認し、審査を進めます。",
  applicationReceiptReview:
    "審査後に初月分の請求書をご案内します。入金の確認で契約が成立します。",
  applicationReconfirmRequired:
    "最新の条件を確認し、内容に同意してから再送信してください。",
  applicationSensitiveInfoWarning:
    "患者さま・お客さまの個人情報は入力しないでください。",
  applicationConsentBusiness: "本サービスを事業のために利用します。",
  applicationConsentTerms:
    "利用規約およびプライバシーポリシーを確認し、同意します。",
  applicationConsentMarketing: "サービスの案内やお知らせを受け取る（任意）",
  applicationConsentPartner:
    "紹介者に、契約の有無・開始と解約の月・支払いの有無を知らせることに同意します。",
} as const;
