import { useMemo } from 'react';
import { App as AntApp, Button, Card, Col, Input, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import { useHoleStore } from '../stores/holeStore';
import { useRunStore } from '../stores/runStore';
import { useBoxStore } from '../stores/boxStore';
import { useLithoStore } from '../stores/lithoStore';
import type { HandoverCheck, HandoverIssueCode, HandoverVerdict } from '../types/handover';
import { buildHandoverList, HANDOVER_RULE_VERSION, HANDOVER_VERDICT_TEXT } from '../utils/handover';
import { buildHandoverCsv, downloadText } from '../utils/export';

const { Title, Paragraph, Text } = Typography;

const VERDICT_ORDER: HandoverVerdict[] = ['blocked', 'pending', 'ready'];

/** 问题项对应的整改入口 */
const ISSUE_TARGET: Record<HandoverIssueCode, { path: string; label: string }> = {
  'run-gap': { path: '/runs', label: '补录回次' },
  'no-run': { path: '/runs', label: '补录回次' },
  'low-recovery': { path: '/runs', label: '核对回次岩芯' },
  'box-capacity': { path: '/boxes', label: '调整岩芯箱' },
  'box-gap': { path: '/boxes', label: '补装箱位' },
  'litho-gap': { path: '/lithology', label: '补编岩性' },
};

/** 交接体检：按孔汇总阻断 / 待补 / 可交接结论，记录变更后随 store 即时重算 */
export default function HandoverBoard() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const holes = useHoleStore((s) => s.holes);
  const setCurrentHole = useHoleStore((s) => s.setCurrentHole);
  const runs = useRunStore((s) => s.runs);
  const boxes = useBoxStore((s) => s.boxes);
  const lithos = useLithoStore((s) => s.lithos);

  const [params, setParams] = useSearchParams();
  const verdictFilter = (params.get('verdict') ?? '') as HandoverVerdict | '';
  const keyword = params.get('kw') ?? '';

  const patchParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    setParams(next, { replace: true });
  };

  /** 全量体检：holes/runs/boxes/lithos 任一变化即重算 */
  const checks = useMemo(() => buildHandoverList(holes, runs, boxes, lithos), [holes, runs, boxes, lithos]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return checks.filter((check) => {
      if (verdictFilter && check.verdict !== verdictFilter) return false;
      if (kw && !`${check.holeNo} ${check.rigNo} ${check.shift}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [checks, verdictFilter, keyword]);

  const countOf = (verdict: HandoverVerdict) => checks.filter((check) => check.verdict === verdict).length;
  const readyRatio = checks.length ? Number(((countOf('ready') / checks.length) * 100).toFixed(1)) : 0;

  const filterLabel = `${verdictFilter ? HANDOVER_VERDICT_TEXT[verdictFilter].label : '全部结论'}${keyword.trim() ? ` · 关键字「${keyword.trim()}」` : ''}`;

  const handleExport = () => {
    if (!filtered.length) {
      message.warning('当前筛选下没有可导出的体检记录');
      return;
    }
    const now = new Date();
    const csv = buildHandoverCsv(filtered, now, filterLabel);
    downloadText(`handover-check-${now.toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    message.success(`已导出 ${filtered.length} 条交接体检归档（规则版本 ${HANDOVER_RULE_VERSION}）`);
  };

  const gotoFix = (check: HandoverCheck, code: HandoverIssueCode) => {
    setCurrentHole(check.holeId);
    navigate(ISSUE_TARGET[code].path);
  };

  const columns: TableColumnsType<HandoverCheck> = [
    {
      title: '孔号',
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.holeNo}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.rigNo} · {row.shift}
          </Text>
        </Space>
      ),
    },
    { title: '已钻深度(m)', dataIndex: 'reachedDepth', width: 110, align: 'right' },
    {
      title: '回次覆盖',
      width: 130,
      render: (_, row) =>
        row.runCount === 0 ? (
          <Tag color="red">无回次</Tag>
        ) : row.runGaps.length ? (
          <Tag color="red">断档 {row.runGaps.length} 段</Tag>
        ) : (
          <Tag color="green">完整 {row.runCount} 回次</Tag>
        ),
    },
    {
      title: '箱位',
      width: 130,
      render: (_, row) =>
        row.capacityBoxes.length || row.boxGaps.length ? (
          <Tag color="red">{row.capacityBoxes.length ? `容量不足 ${row.capacityBoxes.length} 箱` : `未覆盖 ${row.boxGaps.length} 段`}</Tag>
        ) : (
          <Tag color="green">已覆盖</Tag>
        ),
    },
    {
      title: '岩性覆盖',
      width: 120,
      render: (_, row) => (row.lithoGaps.length ? <Tag color="orange">空白 {row.lithoGaps.length} 段</Tag> : <Tag color="green">已覆盖</Tag>),
    },
    {
      title: '采取率',
      width: 130,
      render: (_, row) =>
        row.runCount === 0 ? (
          <Text type="secondary">-</Text>
        ) : (
          <Space size={4}>
            <Text>{row.averageRecovery}%</Text>
            {row.lowRecoveryRuns ? <Tag color="orange">低于75% ×{row.lowRecoveryRuns}</Tag> : <Tag color="green">达标</Tag>}
          </Space>
        ),
    },
    {
      title: '结论',
      width: 100,
      render: (_, row) => <Tag color={HANDOVER_VERDICT_TEXT[row.verdict].color}>{HANDOVER_VERDICT_TEXT[row.verdict].label}</Tag>,
    },
    {
      title: '整改',
      width: 200,
      render: (_, row) => (
        <Space size={2} wrap>
          {Array.from(new Set(row.issues.map((issue) => issue.code))).map((code) => (
            <Button key={code} size="small" type="link" onClick={() => gotoFix(row, code)}>
              {ISSUE_TARGET[code].label}
            </Button>
          ))}
          {row.issues.length === 0 ? <Text type="secondary">—</Text> : null}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        交接体检
      </Title>
      <Paragraph type="secondary">
        交班前按孔汇总回次、箱位、岩性与采取率的交接就绪情况：回次断档或箱位不足为「阻断」，采取率低于 75% 或岩性空白为「待补」，其余「可交接」。
        任一记录变更后结论即时重算。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="阻断" value={countOf('blocked')} unit="孔" status={countOf('blocked') ? 'error' : 'success'} hint="回次断档或箱位不足，不能随箱交接" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="待补" value={countOf('pending')} unit="孔" status={countOf('pending') ? 'warning' : 'success'} hint="采取率低于 75% 或岩性空白" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="可交接" value={countOf('ready')} unit="孔" status="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="可交接率" value={readyRatio} unit="%" status={readyRatio === 100 ? 'success' : 'default'} hint={`共 ${checks.length} 孔参与体检`} />
        </Col>
      </Row>

      <Space wrap size={[8, 8]} style={{ marginBottom: 12 }} align="center">
        <span style={{ color: '#6b7a86' }}>结论</span>
        <Select
          allowClear
          style={{ width: 130 }}
          placeholder="全部"
          value={verdictFilter || undefined}
          options={VERDICT_ORDER.map((verdict) => ({ label: HANDOVER_VERDICT_TEXT[verdict].label, value: verdict }))}
          onChange={(value?: HandoverVerdict) => patchParams({ verdict: value ?? '' })}
        />
        <Input.Search
          allowClear
          style={{ width: 220 }}
          placeholder="搜索孔号 / 钻机 / 班组"
          defaultValue={keyword}
          key={keyword}
          onSearch={(value) => patchParams({ kw: value.trim() })}
        />
        <Button icon={<ReloadOutlined />} onClick={() => patchParams({ verdict: '', kw: '' })} disabled={!verdictFilter && !keyword}>
          重置
        </Button>
        <Tag color={filtered.length === checks.length ? 'default' : 'blue'}>
          命中 {filtered.length} / {checks.length}
        </Tag>
        <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
          导出归档 CSV
        </Button>
        <Tag color="default">规则版本 {HANDOVER_RULE_VERSION}</Tag>
      </Space>

      <Card size="small">
        <Table
          rowKey="holeId"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          scroll={{ x: 1100 }}
          rowClassName={(row) => (row.verdict === 'blocked' ? 'handover-row-blocked' : row.verdict === 'pending' ? 'handover-row-pending' : '')}
          locale={{ emptyText: verdictFilter || keyword ? '当前筛选条件下没有体检记录' : '暂无钻孔，请先到钻孔台帐建孔' }}
          expandable={{
            expandedRowRender: (row) => (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {row.issues.length === 0 ? (
                  <Text type="success">回次、箱位、岩性覆盖完整，采取率均不低于 75%，可随箱交接。</Text>
                ) : (
                  row.issues.map((issue, index) => (
                    <Space key={`${issue.code}-${index}`} size={8} wrap>
                      <Tag color={issue.level === 'blocked' ? 'red' : 'orange'}>{issue.level === 'blocked' ? '阻断' : '待补'}</Tag>
                      <Text>{issue.message}</Text>
                      <Button size="small" type="link" onClick={() => gotoFix(row, issue.code)}>
                        {ISSUE_TARGET[issue.code].label} →
                      </Button>
                    </Space>
                  ))
                )}
              </Space>
            ),
            rowExpandable: () => true,
          }}
        />
      </Card>
    </div>
  );
}
