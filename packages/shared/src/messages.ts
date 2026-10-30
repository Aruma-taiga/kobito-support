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
  boolean: "選択内容を確認してください。",
  unknownField: "入力内容に使用できない項目があります。",
} as const;
