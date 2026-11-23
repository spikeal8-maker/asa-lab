"""Synthetic combined access records only; no real addresses/users or retained log rewrites."""
from datetime import datetime, timedelta, timezone
import json
import unittest

from collect_logs import file_timestamp, normalize, timestamp


FALLBACK = '2020-01-01T00:00:00.000Z'
MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')


def combined(date, address='203.0.113.9', user='-', request='GET /health/ready HTTP/1.1',
             status='200', size='123', referer='-', agent='SyntheticAgent/1'):
    return f'{address} - {user} [{date}] "{request}" {status} {size} "{referer}" "{agent}"'


class NginxFileTimestampTests(unittest.TestCase):
    def test_explicit_english_months_and_numeric_offsets_are_locale_independent(self):
        for month, number in zip(MONTHS, range(1, 13)):
            with self.subTest(month=month):
                self.assertEqual(file_timestamp(combined(f'03/{month}/2020:14:25:36 +0300'), FALLBACK),
                    (f'2020-{number:02}-03T11:25:36.000Z', 'event'))
        for zone, expected in [('-0330', '17:55'), ('+0545', '08:40'), ('+0000', '14:25'), ('-0000', '14:25')]:
            with self.subTest(zone=zone):
                self.assertEqual(file_timestamp(combined('03/Nov/2020:14:25:36 '+zone), FALLBACK),
                    ('2020-11-03T'+expected+':36.000Z', 'event'))

    def test_valid_ipv6_leap_day_and_standard_hex_escaped_fields_need_no_new_identity_fields(self):
        raw = combined('29/Feb/2020:23:59:59 +0000', address='2001:db8::7',
            user=r'synthetic\x20user', agent=r'Synthetic\x22Agent')
        self.assertEqual(file_timestamp(raw+'\r\n', FALLBACK), ('2020-02-29T23:59:59.000Z', 'event'))
        # Only the adapter's timestamp changes. Generic normalization still uses its authoritative argument.
        self.assertEqual(normalize('api', raw, FALLBACK, 'synthetic')['time'], FALLBACK)
        self.assertEqual(len(file_timestamp(raw, FALLBACK)), 2)

    def test_invalid_calendar_month_clock_or_offset_falls_back_without_normalization(self):
        dates = ['30/Feb/2020:12:00:00 +0000', '29/Feb/2021:12:00:00 +0000',
            '31/Apr/2020:12:00:00 +0000', '03/Foo/2020:12:00:00 +0000',
            '03/nov/2020:12:00:00 +0000', '03/Nov/0000:12:00:00 +0000',
            '03/Nov/2020:24:00:00 +0000', '03/Nov/2020:12:60:00 +0000',
            '03/Nov/2020:12:00:60 +0000', '03/Nov/2020:12:00:00 +2400',
            '03/Nov/2020:12:00:00 +0060', '03/Nov/2020:12:00:00 -9999',
            '03/Nov/2020:12:00:00 +03:00', '03/Nov/2020:12:00:00 0300',
            '\u0660\u0663/Nov/2020:12:00:00 +0000',
            '01/Jan/0001:00:00:00 +0100', '31/Dec/9999:23:59:59 -0100']
        for date in dates:
            with self.subTest(date=date):
                self.assertEqual(file_timestamp(combined(date), FALLBACK), (FALLBACK, 'file_mtime'))

    def test_complete_combined_context_is_required_not_an_embedded_bracketed_date(self):
        good = combined('03/Nov/2020:14:25:36 +0300')
        examples = ['message '+good, 'worker error [03/Nov/2020:14:25:36 +0300]',
            json.dumps({'message': good}), good+' arbitrary trailing text',
            good.rsplit(' ', 1)[0], good.replace('203.0.113.9', 'not-an-address'),
            good.replace('203.0.113.9', '999.999.999.999'), good.replace(' - - [', ' other - ['),
            good.replace(' 200 ', ' 999 '), good.replace(' 123 ', ' not-bytes '),
            combined('03/Nov/2020:14:25:36 +0300', agent='broken"quote'),
            combined('03/Nov/2020:14:25:36 +0300', agent='newline\nmessage')]
        for raw in examples:
            with self.subTest(raw=raw):
                self.assertEqual(file_timestamp(raw, FALLBACK), (FALLBACK, 'file_mtime'))

    def test_future_combined_time_uses_the_existing_five_minute_safety_fallback(self):
        future = datetime.now(timezone.utc)+timedelta(days=1)
        date = f'{future.day:02}/{MONTHS[future.month-1]}/{future.year:04}:{future:%H:%M:%S} +0000'
        self.assertEqual(file_timestamp(combined(date), FALLBACK), (FALLBACK, 'file_mtime'))
        near = datetime.now(timezone.utc)+timedelta(minutes=2)
        date = f'{near.day:02}/{MONTHS[near.month-1]}/{near.year:04}:{near:%H:%M:%S} +0000'
        self.assertEqual(file_timestamp(combined(date), FALLBACK),
            (near.isoformat(timespec='seconds').replace('+00:00', '.000Z'), 'event'))

    def test_existing_iso_json_unix_and_fallback_formats_are_unchanged(self):
        expected = '2020-11-03T11:25:36.000Z'
        for raw in ['2020-11-03T14:25:36+03:00 existing event',
                '[2020/11/03 14:25:36+03:00] existing event',
                json.dumps({'time': '2020-11-03T11:25:36Z'}),
                json.dumps({'timestamp': 1604402736}), json.dumps({'ts': 1604402736000})]:
            with self.subTest(raw=raw):
                self.assertEqual(file_timestamp(raw, FALLBACK), (expected, 'event'))
        local = '2020-11-03 14:25:36'
        self.assertEqual(file_timestamp(local+' local event', FALLBACK), (timestamp(local, ''), 'event'))
        self.assertEqual(file_timestamp('ordinary undated event', FALLBACK), (FALLBACK, 'file_mtime'))


if __name__ == '__main__':
    unittest.main()
