// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Badge,
  BrandHeader,
  Button,
  Card,
  DefinitionList,
  Field,
  Notice,
  PageShell,
  Steps,
  Table,
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
