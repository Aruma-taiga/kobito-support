import {
  Children,
  cloneElement,
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
  const classes = cx(
    "ui-btn",
    `ui-btn--${variant}`,
    size === "sm" && "ui-btn--sm",
    fullWidth && "ui-btn--full",
    className,
  );
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
