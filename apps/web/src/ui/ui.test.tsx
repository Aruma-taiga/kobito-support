// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AmountRows,
  BackLink,
  Badge,
  Block,
  BrandHeader,
  Button,
  buttonClass,
  Card,
  CreditRing,
  DefinitionList,
  Field,
  FilterChips,
  ListItem,
  Notice,
  PageShell,
  StatTiles,
  Steps,
  TabBar,
  TabBarItem,
  Table,
  Timeline,
} from "./index.js";

afterEach(cleanup);

describe("Button", () => {
  it("renders a button with variant and size classes", () => {
    render(
      <Button variant="dark" size="sm" fullWidth>
        送信
      </Button>,
    );
    const el = screen.getByRole("button", { name: "送信" });
    expect(el.className).toContain("ui-btn");
    expect(el.className).toContain("ui-btn--dark");
    expect(el.className).toContain("ui-btn--sm");
    expect(el.className).toContain("ui-btn--full");
    expect(el.getAttribute("type")).toBe("button");
  });
  it("defaults to primary", () => {
    render(<Button>a</Button>);
    expect(screen.getByRole("button").className).toContain("ui-btn--primary");
  });
  it("renders an anchor for href", () => {
    render(<Button href="/apply/shop">申込み</Button>);
    const el = screen.getByRole("link", { name: "申込み" });
    expect(el.getAttribute("href")).toBe("/apply/shop");
    expect(el.className).toContain("ui-btn");
  });
});

describe("Card", () => {
  it("renders heading and body", () => {
    render(<Card title="見出し">本文</Card>);
    expect(screen.getByRole("heading", { name: "見出し" })).toBeTruthy();
    expect(screen.getByText("本文")).toBeTruthy();
  });
});

describe("Badge", () => {
  it("maps tone to class", () => {
    render(<Badge tone="warn">注意</Badge>);
    expect(screen.getByText("注意").className).toContain("ui-badge--warn");
  });
  it("defaults to gray", () => {
    render(<Badge>x</Badge>);
    expect(screen.getByText("x").className).toContain("ui-badge--gray");
  });
});

describe("Notice", () => {
  it("uses role alert for warn", () => {
    render(<Notice tone="warn">失敗</Notice>);
    const el = screen.getByRole("alert");
    expect(el.className).toContain("ui-notice--warn");
  });
  it("has no alert role for info and shows the title", () => {
    render(
      <Notice tone="info" title="お知らせ">
        内容
      </Notice>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("お知らせ")).toBeTruthy();
    expect(screen.getByText("内容").closest(".ui-notice--info")).toBeTruthy();
  });
});

describe("Field", () => {
  it("links label, hint and input; shows required badge", () => {
    render(
      <Field label="店舗名" required hint="正式名称">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText(/店舗名/);
    expect(screen.getByText("必須")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBeNull();
    const hint = screen.getByText("正式名称");
    expect(input.getAttribute("aria-describedby")).toContain(hint.id);
    expect(input.className).toContain("ui-input");
  });
  it("shows optional badge", () => {
    render(
      <Field label="電話" optional>
        <input />
      </Field>,
    );
    expect(screen.getByText("任意")).toBeTruthy();
    expect(screen.queryByText("必須")).toBeNull();
  });
  it("marks invalid and describes by error", () => {
    render(
      <Field label="メール" required error="形式が正しくありません">
        <input />
      </Field>,
    );
    const input = screen.getByLabelText(/メール/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const err = screen.getByText("形式が正しくありません");
    expect(err.getAttribute("role")).toBe("alert");
    expect(input.getAttribute("aria-describedby")).toContain(err.id);
  });
  it("works with textarea and select", () => {
    render(
      <Field label="内容">
        <textarea />
      </Field>,
    );
    expect(screen.getByLabelText("内容").tagName).toBe("TEXTAREA");
  });
});

describe("DefinitionList", () => {
  it("renders dt/dd pairs", () => {
    const { container } = render(
      <DefinitionList
        items={[
          { term: "プラン", description: "ライト" },
          { term: "金額", description: "5,000円" },
        ]}
      />,
    );
    expect(container.querySelectorAll("dt").length).toBe(2);
    expect(container.querySelector("dd")?.textContent).toBe("ライト");
  });
});

describe("Steps", () => {
  it("marks the current step with aria-current", () => {
    render(<Steps labels={["お店", "プラン", "確認"]} current={1} />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(3);
    expect(items[0]?.className).toContain("ui-steps__item--done");
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(items[1]?.className).toContain("ui-steps__item--now");
    expect(items[2]?.getAttribute("aria-current")).toBeNull();
  });
});

describe("Table", () => {
  it("renders headers and rows inside a scroll container", () => {
    render(
      <Table
        caption="一覧"
        columns={[
          { key: "a", header: "名前" },
          { key: "b", header: "金額", numeric: true },
        ]}
        rows={[{ a: "山田", b: "100" }]}
      />,
    );
    expect(screen.getByRole("table", { name: "一覧" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "金額" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "100" }).className).toContain(
      "ui-table__num",
    );
    expect(screen.getByRole("table").parentElement?.className).toContain(
      "ui-table-wrap",
    );
  });
});

describe("BrandHeader / PageShell", () => {
  it("shows the service name, logo path and right slot", () => {
    const { container } = render(
      <BrandHeader
        serviceName="テストサービス"
        right={<a href="/x">申込み</a>}
      />,
    );
    expect(screen.getByText("テストサービス")).toBeTruthy();
    expect(screen.getByRole("link", { name: "申込み" })).toBeTruthy();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/kobito-symbol.svg");
    expect(img?.getAttribute("alt")).toBe("");
    expect(container.querySelector("header")?.className).toContain(
      "ui-brand-header",
    );
  });
  it("PageShell wraps header and content", () => {
    render(
      <PageShell header={<BrandHeader serviceName="S" />}>
        <p>中身</p>
      </PageShell>,
    );
    expect(screen.getByRole("main")).toBeTruthy();
    expect(screen.getByText("中身")).toBeTruthy();
  });
});

describe("customer screen parts", () => {
  it("buttonClass gives links the button look", () => {
    expect(buttonClass("ghost", { size: "sm" })).toBe(
      "ui-btn ui-btn--ghost ui-btn--sm",
    );
  });

  it("AmountRows shows rows then a total with a note", () => {
    render(
      <AmountRows
        rows={[{ label: "小計（税抜）", amount: "10,000円" }]}
        total={{ label: "合計（税込）", amount: "11,000円" }}
        note="うち消費税1,000円"
      />,
    );
    expect(document.body.textContent).toBe(
      "小計（税抜）10,000円合計（税込）11,000円うち消費税1,000円",
    );
  });

  it("CreditRing shows remaining over total and clamps the arc", () => {
    const { container } = render(<CreditRing remaining={-1} total={3} />);
    expect(container.textContent).toContain("-1");
    expect(container.textContent).toContain("残り / 3");
    expect(
      (container.firstElementChild as HTMLElement).style.getPropertyValue(
        "--ring-share",
      ),
    ).toBe("0%");
  });

  it("ListItem renders title, meta and badge in the given component", () => {
    render(
      <ListItem
        badge={<Badge tone="sage">作業中</Badge>}
        component="a"
        href="/x"
        meta="目安：11/14"
        title="営業時間の更新"
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/x");
    expect(link.textContent).toBe("営業時間の更新目安：11/14作業中");
  });

  it("FilterChips marks the selected option and reports changes", () => {
    const seen: string[] = [];
    render(
      <FilterChips
        label="表示"
        onChange={(value) => seen.push(value)}
        options={[
          { value: "all", label: "すべて" },
          { value: "done", label: "完了" },
        ]}
        value="all"
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "すべて" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "完了" }));
    expect(seen).toEqual(["done"]);
  });

  it("TabBar marks the current tab", () => {
    render(
      <TabBar label="メニュー">
        <TabBarItem current href="/me" icon="⌂">
          ホーム
        </TabBarItem>
        <TabBarItem href="/me/requests" icon="☰">
          依頼
        </TabBarItem>
      </TabBar>,
    );
    expect(
      screen.getByRole("link", { name: "ホーム" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "依頼" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("StatTiles, Block, BackLink and Timeline render their content", () => {
    render(
      <>
        <StatTiles items={[{ key: "c", label: "使うクレジット", value: 1 }]} />
        <Block title="含まれないもの">
          <p>写真の撮影</p>
        </Block>
        <BackLink href="/me/requests">ご依頼の状況</BackLink>
        <Timeline items={[{ key: "a", done: true, content: "送る" }]} />
      </>,
    );
    expect(document.body.textContent).toContain("使うクレジット1");
    expect(screen.getByText("写真の撮影")).toBeTruthy();
    expect(screen.getByRole("link").textContent).toBe("‹ ご依頼の状況");
    expect(document.querySelector(".ui-timeline__done")).toBeTruthy();
  });
});
