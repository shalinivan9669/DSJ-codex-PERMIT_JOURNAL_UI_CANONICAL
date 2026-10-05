"""Use the API-supported overflow contract before issuing any document."""
import json,tempfile,unittest
from pathlib import Path
from test_render import fixture
from renderer import preflight

class NeutralPreflightTests(unittest.TestCase):
    def test_card_and_certificate_overflow_returns_actionable_issues(self):
        snapshots=[]
        for tid in ['biot-worker-card','pb-card','ps-card','ptm-card','biot-itr-certificate','ps-witness']:
            snapshot=fixture(tid)
            snapshot['items'][0]['fullNameRu']='Слишком длинное значение ' * 150
            snapshot['items'][0]['fullNameKz']='Өте ұзақ мән ' * 150
            snapshots.append(snapshot)
        with tempfile.TemporaryDirectory() as temp:
            out=Path(temp)/'preflight.json'
            result=preflight({'snapshots':snapshots},out)
            self.assertEqual(result['checked'],6)
            self.assertEqual(result['issues'],[{'index':i,'code':'PRINT_LAYOUT_OVERFLOW'} for i in range(6)])
            self.assertEqual(json.loads(out.read_text()),result)

if __name__=='__main__':unittest.main()
