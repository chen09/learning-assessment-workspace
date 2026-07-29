"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

export type Language = "en" | "ja" | "zh";

const messages = {
  en: {
    "brand.tagline": "family learning",
    "nav.home": "Home",
    "nav.create": "Create",
    "nav.history": "History",
    "nav.library": "Library",
    "nav.family": "Family",
    "nav.work": "Work",
    "nav.review": "Review",
    "navigation.parent": "Parent navigation",
    "navigation.child": "Child navigation",
    "navigation.mobile": "{role} mobile navigation",
    "identity.parent": "Parent",
    "role.parent": "Parent mode",
    "role.child": "Child mode",
    "action.exitChild": "Exit child mode",
    "language.label": "Language",
    "parentDashboard.eyebrow": "Parent workspace",
    "parentDashboard.title": "Set up your family workspace",
    "parentDashboard.description":
      "Add your family and children before creating their first practice set.",
    "parentDashboard.firstStep": "First step",
    "parentDashboard.familyAction": "Create or join a family",
    "parentDashboard.familyDetails":
      "Family setup keeps each child's assignments, photos, results, and review schedule separate.",
    "parentDashboard.openFamilySetup": "Open family setup",
    "parentDashboard.private": "Private by default",
    "parentDashboard.accountReady": "Your account is ready",
    "parentDashboard.accountReadyDetails":
      "Nothing from the sample family is attached to your account. Your workspace starts empty and only shows the people you add or join.",
    "parentDashboard.continueFamilySetup": "Continue to family setup",
    "family.eyebrow": "Family workspace",
    "family.createTitle": "Create your family",
    "family.loadingTitle": "Loading your workspace…",
    "family.description":
      "Parents share one family. Each member keeps an independent language preference.",
    "family.switcherLabel": "Family switcher",
    "family.currentLabel": "Current family",
    "family.choose": "Choose a family",
    "family.newNameLabel": "New family name",
    "family.newNamePlaceholder": "New family name",
    "family.add": "Add family",
    "family.invitation":
      "A family invitation for {email} expires {date}.",
    "family.accept": "Accept",
    "family.children": "Children",
    "family.profilesPin": "Profiles and PIN",
    "family.managementPin": "Parent management PIN",
    "family.sixDigits": "6 digits",
    "family.managementUnlocked": "Management unlocked for 10 minutes",
    "family.unlockPin": "Unlock PIN controls",
    "family.setManagementPin": "Set management PIN",
    "family.managementNote":
      "A short management unlock is required before a child PIN can be changed.",
    "family.uiLanguage": "{language} UI",
    "family.createPractice": "Create practice",
    "family.childSignIn": "Child sign in",
    "family.newPinFor": "New PIN for {name}",
    "family.pinPlaceholder": "6-digit PIN",
    "family.savePin": "Save PIN",
    "family.managePin": "Manage PIN",
    "family.childName": "Child name",
    "family.grade": "Grade",
    "family.sixDigitPin": "Six-digit PIN",
    "family.addChild": "Add child",
    "family.parents": "Parents",
    "family.inviteParent": "Invite another parent",
    "family.inviteNote":
      "A family can have up to four parents. Invitations expire after seven days. The MVP does not send external email.",
    "family.parentEmail": "Parent email",
    "family.createInvite": "Create invite",
    "family.inviteCreated":
      "Invite created for {email}. They can accept it after signing in with that verified email.",
    "family.saveError":
      "The change could not be saved. Please check the details and try again.",
    "family.accountSettings": "Open my sign-in and language settings",
  },
  ja: {
    "brand.tagline": "家族で学ぶ",
    "nav.home": "ホーム",
    "nav.create": "作成",
    "nav.history": "履歴",
    "nav.library": "問題集",
    "nav.family": "家族",
    "nav.work": "学習",
    "nav.review": "復習",
    "navigation.parent": "保護者ナビゲーション",
    "navigation.child": "子どもナビゲーション",
    "navigation.mobile": "{role}モバイルナビゲーション",
    "identity.parent": "保護者",
    "role.parent": "保護者モード",
    "role.child": "子どもモード",
    "action.exitChild": "子どもモードを終了",
    "language.label": "言語",
    "parentDashboard.eyebrow": "保護者ワークスペース",
    "parentDashboard.title": "家族の学習スペースを設定",
    "parentDashboard.description":
      "最初の練習を作る前に、家族とお子さまを登録してください。",
    "parentDashboard.firstStep": "最初のステップ",
    "parentDashboard.familyAction": "家族を作成または参加",
    "parentDashboard.familyDetails":
      "家族設定では、お子さまごとの課題、写真、結果、復習予定を分けて管理します。",
    "parentDashboard.openFamilySetup": "家族設定を開く",
    "parentDashboard.private": "初期設定では非公開",
    "parentDashboard.accountReady": "アカウントの準備ができました",
    "parentDashboard.accountReadyDetails":
      "サンプル家族の情報はアカウントに紐づいていません。学習スペースは空の状態から始まり、追加または参加したメンバーだけが表示されます。",
    "parentDashboard.continueFamilySetup": "家族設定へ進む",
    "family.eyebrow": "家族の学習スペース",
    "family.createTitle": "家族を作成",
    "family.loadingTitle": "学習スペースを読み込み中…",
    "family.description":
      "保護者は一つの家族を共有し、各メンバーは表示言語を個別に選べます。",
    "family.switcherLabel": "家族の切り替え",
    "family.currentLabel": "現在の家族",
    "family.choose": "家族を選択",
    "family.newNameLabel": "新しい家族名",
    "family.newNamePlaceholder": "新しい家族名",
    "family.add": "家族を追加",
    "family.invitation":
      "{email} 宛ての家族招待は {date} に期限切れになります。",
    "family.accept": "参加する",
    "family.children": "子ども",
    "family.profilesPin": "プロフィールと PIN",
    "family.managementPin": "保護者管理 PIN",
    "family.sixDigits": "6桁の数字",
    "family.managementUnlocked": "管理機能を10分間解除しました",
    "family.unlockPin": "PIN 管理を解除",
    "family.setManagementPin": "管理 PIN を設定",
    "family.managementNote":
      "お子さまの PIN を変更するには、一時的に管理機能を解除する必要があります。",
    "family.uiLanguage": "{language} 表示",
    "family.createPractice": "練習を作成",
    "family.childSignIn": "子どもとしてログイン",
    "family.newPinFor": "{name} の新しい PIN",
    "family.pinPlaceholder": "6桁の PIN",
    "family.savePin": "PIN を保存",
    "family.managePin": "PIN を管理",
    "family.childName": "子どもの名前",
    "family.grade": "学年",
    "family.sixDigitPin": "6桁の PIN",
    "family.addChild": "子どもを追加",
    "family.parents": "保護者",
    "family.inviteParent": "別の保護者を招待",
    "family.inviteNote":
      "一つの家族には最大4人の保護者が参加できます。招待は7日後に期限切れになります。MVP では外部メールを送信しません。",
    "family.parentEmail": "保護者のメールアドレス",
    "family.createInvite": "招待を作成",
    "family.inviteCreated":
      "{email} の招待を作成しました。認証済みのメールアドレスでログインすると参加できます。",
    "family.saveError":
      "変更を保存できませんでした。入力内容を確認して、もう一度お試しください。",
    "family.accountSettings": "ログインと言語設定を開く",
  },
  zh: {
    "brand.tagline": "家庭学习",
    "nav.home": "首页",
    "nav.create": "创建",
    "nav.history": "历史",
    "nav.library": "题库",
    "nav.family": "家庭",
    "nav.work": "答题",
    "nav.review": "复习",
    "navigation.parent": "家长导航",
    "navigation.child": "孩子导航",
    "navigation.mobile": "{role}移动端导航",
    "identity.parent": "家长",
    "role.parent": "家长模式",
    "role.child": "孩子模式",
    "action.exitChild": "退出孩子模式",
    "language.label": "语言",
    "parentDashboard.eyebrow": "家长空间",
    "parentDashboard.title": "设置家庭学习空间",
    "parentDashboard.description":
      "先添加家庭和孩子，再为他们创建第一份练习。",
    "parentDashboard.firstStep": "第一步",
    "parentDashboard.familyAction": "创建或加入家庭",
    "parentDashboard.familyDetails":
      "家庭设置会分别保存每个孩子的任务、照片、结果和复习计划。",
    "parentDashboard.openFamilySetup": "进入家庭设置",
    "parentDashboard.private": "默认仅家庭可见",
    "parentDashboard.accountReady": "您的账号已准备好",
    "parentDashboard.accountReadyDetails":
      "示例家庭的数据不会关联到您的账号。家庭学习空间从空白开始，只显示您添加或加入的成员。",
    "parentDashboard.continueFamilySetup": "继续设置家庭",
    "family.eyebrow": "家庭学习空间",
    "family.createTitle": "创建您的家庭",
    "family.loadingTitle": "正在加载家庭空间…",
    "family.description":
      "家长共用一个家庭空间，每位成员都可以独立选择界面语言。",
    "family.switcherLabel": "切换家庭",
    "family.currentLabel": "当前家庭",
    "family.choose": "选择家庭",
    "family.newNameLabel": "新家庭名称",
    "family.newNamePlaceholder": "新家庭名称",
    "family.add": "添加家庭",
    "family.invitation": "发送给 {email} 的家庭邀请将于 {date} 失效。",
    "family.accept": "接受邀请",
    "family.children": "孩子",
    "family.profilesPin": "孩子档案与 PIN",
    "family.managementPin": "家长管理 PIN",
    "family.sixDigits": "6 位数字",
    "family.managementUnlocked": "管理权限已解锁 10 分钟",
    "family.unlockPin": "解锁 PIN 管理",
    "family.setManagementPin": "设置管理 PIN",
    "family.managementNote":
      "修改孩子的 PIN 前，需要先进行一次短时管理解锁。",
    "family.uiLanguage": "{language} 界面",
    "family.createPractice": "创建练习",
    "family.childSignIn": "孩子登录",
    "family.newPinFor": "为 {name} 设置新 PIN",
    "family.pinPlaceholder": "6 位 PIN",
    "family.savePin": "保存 PIN",
    "family.managePin": "管理 PIN",
    "family.childName": "孩子姓名",
    "family.grade": "年级",
    "family.sixDigitPin": "六位 PIN",
    "family.addChild": "添加孩子",
    "family.parents": "家长",
    "family.inviteParent": "邀请另一位家长",
    "family.inviteNote":
      "一个家庭最多可有四位家长。邀请将在 7 天后失效。MVP 暂不发送外部邮件。",
    "family.parentEmail": "家长邮箱",
    "family.createInvite": "创建邀请",
    "family.inviteCreated":
      "已为 {email} 创建邀请。对方使用这个已验证邮箱登录后即可接受邀请。",
    "family.saveError": "无法保存更改。请检查填写内容后重试。",
    "family.accountSettings": "打开我的登录与语言设置",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];
type MessageValues = Record<string, string | number>;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, values?: MessageValues) => string;
};

function interpolate(message: string, values?: MessageValues) {
  if (!values) {
    return message;
  }

  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

const defaultLanguageContext: LanguageContextValue = {
  language: "en",
  setLanguage: () => undefined,
  t: (key, values) => interpolate(messages.en[key], values),
};

const LanguageContext = createContext<LanguageContextValue>(
  defaultLanguageContext,
);

const languageEvent = "luma-language-change";

function readLanguage(storageKey: string): Language {
  const stored = window.localStorage.getItem(`luma-language:${storageKey}`);
  return stored === "ja" || stored === "zh" ? stored : "en";
}

function subscribeToLanguage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(languageEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(languageEvent, onChange);
  };
}

export function LanguageProvider({
  children,
  storageKey = "public",
}: {
  children: ReactNode;
  storageKey?: string;
}) {
  const language = useSyncExternalStore<Language>(
    subscribeToLanguage,
    () => readLanguage(storageKey),
    () => "en",
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        window.localStorage.setItem(
          `luma-language:${storageKey}`,
          nextLanguage,
        );
        document.documentElement.lang = nextLanguage;
        window.dispatchEvent(new Event(languageEvent));
      },
      t: (key, values) => interpolate(messages[language][key], values),
    }),
    [language, storageKey],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
