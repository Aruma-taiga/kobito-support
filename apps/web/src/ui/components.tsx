import {
  Children,
  cloneElement,
  type ElementType,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";

function cx(...names: Array<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

/* ---------- Button ---------- */
type ButtonBase = {
  variant?: "primary" | "ghost" | "dark";
  size?: "md" | "sm";
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
};
export type ButtonProps = ButtonBase &
  (
    | ({ href?: undefined } & Omit<
        React.ButtonHTMLAttributes<HTMLButtonElement>,
        "className" | "children"
      >)
    | ({ href: string } & Omit<
        React.AnchorHTMLAttributes<HTMLAnchorElement>,
        "className" | "children" | "href"
      >)
  );

/** ルーターのリンクなどにボタンの見た目を付けるときのクラス名。 */
export function buttonClass(
  variant: "primary" | "ghost" | "dark" = "primary",
  options: {
    size?: "md" | "sm" | undefined;
    fullWidth?: boolean | undefined;
    className?: string | undefined;
  } = {},
): string {
  return cx(
    "ui-btn",
    `ui-btn--${variant}`,
    options.size === "sm" && "ui-btn--sm",
    options.fullWidth && "ui-btn--full",
    options.className,
  );
}

/** href を渡すとリンクとして描画する。ルーターのリンクは Button の見た目を className 経由で使う。 */
export function Button(props: ButtonProps) {
  const {
    variant = "primary",
    size = "md",
    fullWidth,
    className,
    children,
    ...rest
  } = props;
  const classes = buttonClass(variant, { size, fullWidth, className });
  if ("href" in rest && rest.href !== undefined) {
    const anchorProps = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <a {...anchorProps} className={classes}>
        {children}
      </a>
    );
  }
  const buttonProps = rest as React.ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button type="button" {...buttonProps} className={classes}>
      {children}
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({
  title,
  action,
  className,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cx("ui-card", className)}>
      {title ? (
        <h3 className="ui-card__title">
          <span>{title}</span>
          {action}
        </h3>
      ) : null}
      {children}
    </section>
  );
}

/* ---------- Badge ---------- */
export type BadgeTone = "sage" | "yellow" | "warn" | "gray" | "dark";
export function Badge({
  tone = "gray",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span className={cx("ui-badge", `ui-badge--${tone}`)}>{children}</span>
  );
}

/* ---------- Notice ---------- */
export type NoticeTone = "info" | "yellow" | "warn";
export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx("ui-notice", `ui-notice--${tone}`)}
      role={tone === "warn" ? "alert" : undefined}
    >
      {title ? <b className="ui-notice__title">{title}</b> : null}
      {children}
    </div>
  );
}

/* ---------- Field ---------- */
export function Field({
  label,
  required,
  optional,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  /** input / textarea / select を1つ渡す。id・aria 属性を注入する */
  children: ReactElement<Record<string, unknown>>;
}) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const describedBy =
    [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") ||
    undefined;
  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child, {
        id: (child.props.id as string | undefined) ?? inputId,
        className: cx("ui-input", child.props.className as string | undefined),
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : child;
  const controlId = isValidElement(child)
    ? ((child.props.id as string | undefined) ?? inputId)
    : inputId;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
        {required ? <span className="ui-req">必須</span> : null}
        {!required && optional ? <span className="ui-opt">任意</span> : null}
      </label>
      {control}
      {hint ? (
        <p className="ui-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="ui-hint ui-hint--error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- DefinitionList ---------- */
export function DefinitionList({
  items,
}: {
  items: Array<{ term: ReactNode; description: ReactNode }>;
}) {
  return (
    <dl className="ui-dl">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 静的な表示用リスト
        <div className="ui-dl__row" key={index}>
          <dt>{item.term}</dt>
          <dd>{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Steps ---------- */
/** current は 0 始まり。それより前は done、一致するものが now（aria-current="step"）。 */
export function Steps({
  labels,
  current,
  label,
}: {
  labels: string[];
  current: number;
  label?: string;
}) {
  return (
    <ol className="ui-steps" aria-label={label}>
      {labels.map((label, index) => (
        <li
          key={label}
          className={cx(
            "ui-steps__item",
            index < current && "ui-steps__item--done",
            index === current && "ui-steps__item--now",
          )}
          aria-current={index === current ? "step" : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

/* ---------- Table ---------- */
export type TableColumn = {
  key: string;
  header: ReactNode;
  numeric?: boolean;
};
/** 狭幅では容器内だけ横スクロールする（ページ全体は伸ばさない）。 */
export function Table({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: TableColumn[];
  rows: Array<Record<string, ReactNode>>;
}) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table" aria-label={caption}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(column.numeric && "ui-table__num")}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 表示専用の行
            <tr key={index}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(column.numeric && "ui-table__num")}
                >
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- BrandHeader / PageShell ---------- */
export function BrandHeader({
  serviceName,
  right,
  logoSrc = "/kobito-symbol.svg",
}: {
  serviceName: string;
  right?: ReactNode;
  logoSrc?: string;
}) {
  return (
    <header className="ui-brand-header">
      <span className="ui-brand-header__brand">
        <img className="ui-brand-header__logo" src={logoSrc} alt="" />
        <span className="ui-brand-header__name">{serviceName}</span>
      </span>
      {right ? <div className="ui-brand-header__right">{right}</div> : null}
    </header>
  );
}

export function PageShell({
  header,
  children,
}: {
  header?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="ui-shell">
      {header}
      <main className="ui-shell__main">{children}</main>
    </div>
  );
}

/* ---------- RadioOption / CheckOption ---------- */
export function RadioOption({
  checked,
  disabled,
  title,
  price,
  description,
  ...inputProps
}: {
  checked: boolean;
  disabled?: boolean;
  title: ReactNode;
  price?: ReactNode;
  description?: ReactNode;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "checked" | "disabled" | "title" | "className"
>) {
  return (
    <label
      className={cx(
        "ui-radio",
        checked && "ui-radio--on",
        disabled && "ui-radio--disabled",
      )}
    >
      <input
        {...inputProps}
        type="radio"
        checked={checked}
        disabled={disabled}
      />
      <span className="ui-radio__body">
        <span className="ui-radio__title">
          <span>{title}</span>
          {price ? <em className="ui-radio__price">{price}</em> : null}
        </span>
        {description ? (
          <span className="ui-radio__desc">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

export function CheckOption({
  required,
  optional,
  children,
  ...inputProps
}: {
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  return (
    <label className="ui-check">
      <input {...inputProps} type="checkbox" required={required} />
      <span>
        {children}
        {required ? <span className="ui-req">必須</span> : null}
        {!required && optional ? <span className="ui-opt">任意</span> : null}
      </span>
    </label>
  );
}

/* ---------- Page / Title / Lead ---------- */
/** 1列の画面本体。tabbed は下部タブ分の余白を足す。 */
export function Page({
  tabbed,
  children,
}: {
  tabbed?: boolean;
  children?: ReactNode;
}) {
  return (
    <main className={cx("ui-page", tabbed && "ui-page--tabbed")}>
      {children}
    </main>
  );
}

export function Title({
  id,
  center,
  children,
}: {
  id?: string;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <h1 className={cx("ui-title", center && "ui-center")} id={id}>
      {children}
    </h1>
  );
}

export function Lead({
  center,
  children,
}: {
  center?: boolean;
  children: ReactNode;
}) {
  return <p className={cx("ui-lead", center && "ui-center")}>{children}</p>;
}

/** 小さな補足文。center で中央寄せ、right で右寄せ。 */
export function Hint({
  align,
  children,
}: {
  align?: "center" | "right";
  children: ReactNode;
}) {
  return (
    <p
      className={cx(
        "ui-hint",
        align === "center" && "ui-center",
        align === "right" && "ui-right",
      )}
    >
      {children}
    </p>
  );
}

/* ---------- BackLink ---------- */
/** 「‹ 戻り先」。component にルーターの Link などを渡せる。 */
export function BackLink({
  component: Component = "a",
  children,
  ...rest
}: {
  component?: ElementType;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <p className="ui-back">
      <Component {...rest}>‹ {children}</Component>
    </p>
  );
}

/* ---------- ListItem ---------- */
/** 左にタイトルと補足、右にバッジ。component にルーターの Link などを渡せる。 */
export function ListItem({
  component: Component = "div",
  title,
  meta,
  badge,
  ...rest
}: {
  component?: ElementType;
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
} & Record<string, unknown>) {
  return (
    <Component {...rest} className="ui-list-item">
      <span className="ui-list-item__main">
        <span className="ui-list-item__title">{title}</span>
        {meta ? <span className="ui-list-item__meta">{meta}</span> : null}
      </span>
      {badge}
    </Component>
  );
}

/* ---------- AmountRows ---------- */
/** 金額の明細。total は太線の下に出す合計行。note は右寄せの補足。 */
export function AmountRows({
  rows,
  total,
  note,
}: {
  rows: Array<{ label: ReactNode; amount: ReactNode }>;
  total?: { label: ReactNode; amount: ReactNode };
  note?: ReactNode;
}) {
  return (
    <div className="ui-amounts">
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 表示専用の行
        <div className="ui-amounts__row" key={index}>
          <span>{row.label}</span>
          <span className="ui-price">{row.amount}</span>
        </div>
      ))}
      {total ? (
        <div className="ui-amounts__row ui-amounts__row--total">
          <span>{total.label}</span>
          <span className="ui-price">{total.amount}</span>
        </div>
      ) : null}
      {note ? <p className="ui-hint ui-right">{note}</p> : null}
    </div>
  );
}

/* ---------- CreditRing ---------- */
/** 残り / 付与 の輪。残り分を濃い色で描く。 */
export function CreditRing({
  remaining,
  total,
}: {
  remaining: number;
  total: number;
}) {
  const share =
    total > 0 ? Math.min(100, Math.max(0, (remaining / total) * 100)) : 0;
  return (
    <div
      className="ui-ring"
      style={{ "--ring-share": `${share}%` } as React.CSSProperties}
    >
      <div>
        <strong>{remaining}</strong>
        <small>残り / {total}</small>
      </div>
    </div>
  );
}

/* ---------- Timeline ---------- */
export function Timeline({
  items,
}: {
  items: Array<{ key: string; done?: boolean; content: ReactNode }>;
}) {
  return (
    <ul className="ui-timeline">
      {items.map((item) => (
        <li key={item.key} className={cx(item.done && "ui-timeline__done")}>
          {item.content}
        </li>
      ))}
    </ul>
  );
}

export function DoneMark() {
  return (
    <div className="ui-done-mark" aria-hidden="true">
      ✓
    </div>
  );
}

/* ---------- StatTiles / Block ---------- */
export function StatTiles({
  items,
}: {
  items: Array<{
    key: string;
    label: ReactNode;
    value: ReactNode;
    tone?: "accent" | "gray";
  }>;
}) {
  return (
    <div className="ui-tiles">
      {items.map((item) => (
        <div
          className={cx("ui-tile", `ui-tile--${item.tone ?? "accent"}`)}
          key={item.key}
        >
          <small>{item.label}</small>
          <div className="ui-tile__value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

/** 小見出し付きの区切り（見積の作業内容など）。 */
export function Block({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ui-block">
      <h4 className="ui-block__title">{title}</h4>
      {children}
    </div>
  );
}

/* ---------- FilterChips ---------- */
export function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
}) {
  return (
    <fieldset className="ui-chips">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx("ui-chip", option.value === value && "ui-chip--on")}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

/* ---------- TabBar ---------- */
export function TabBar({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <nav className="ui-tabbar" aria-label={label}>
      <div className="ui-tabbar__inner">{children}</div>
    </nav>
  );
}

/** component にルーターの NavLink / Link を渡せる。 */
export function TabBarItem({
  component: Component = "a",
  icon,
  current,
  children,
  ...rest
}: {
  component?: ElementType;
  icon: string;
  current?: boolean;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Component
      {...rest}
      className={cx("ui-tab", current && "ui-tab--on")}
      aria-current={current ? "page" : undefined}
    >
      <i aria-hidden="true">{icon}</i>
      {children}
    </Component>
  );
}
