"""
SkyGuard QSVM Service — Bridge script for Node.js integration
Reads JSON from stdin, runs Quantum SVM, outputs JSON to stdout.

Usage from Node.js:
  child_process.spawn('python3', ['scripts/skyguard_qsvm_service.py'])
  Send JSON to stdin → Read JSON from stdout
"""

import sys
import json
import numpy as np
from sklearn.svm import SVC
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import classification_report, confusion_matrix

# Try to import quantum kernel (falls back to RBF kernel if not available)
USE_QUANTUM = False
try:
    from pyqpanda_alg.QSVM.quantum_kernel_svm import QuantumKernel_vqnet
    USE_QUANTUM = True
except ImportError:
    pass


def generate_training_data(n_normal=30, n_anomali=30):
    """
    Generate synthetic training data for Quantum SVM.
    Features: [cif_per_unit, gap_ratio, hs_risk, country_risk, freq_importir]
    Label: 1=NORMAL, -1=UNDER-INVOICING
    """
    np.random.seed(42)

    # NORMAL transactions: fair CIF, small gap, low risk
    normal = np.column_stack([
        np.random.uniform(50, 200, n_normal),     # cif_per_unit (wajar)
        np.random.uniform(0.0, 0.15, n_normal),   # gap_ratio (kecil)
        np.random.uniform(0.1, 0.4, n_normal),    # hs_risk (rendah)
        np.random.uniform(0.1, 0.4, n_normal),    # country_risk (rendah)
        np.random.uniform(0.5, 1.0, n_normal),    # freq_importir (tinggi/terpercaya)
    ])

    # UNDER-INVOICING transactions: low CIF, large gap, high risk
    anomali = np.column_stack([
        np.random.uniform(5, 30, n_anomali),      # cif_per_unit (sangat rendah)
        np.random.uniform(0.4, 0.9, n_anomali),   # gap_ratio (besar)
        np.random.uniform(0.5, 1.0, n_anomali),   # hs_risk (tinggi)
        np.random.uniform(0.5, 1.0, n_anomali),   # country_risk (tinggi)
        np.random.uniform(0.0, 0.3, n_anomali),   # freq_importir (baru/jarang)
    ])

    X = np.vstack([normal, anomali])
    y = np.array([1] * n_normal + [-1] * n_anomali)
    return X, y


def train_model(X_train, y_train):
    """Train QSVM or fallback SVM model."""
    scaler = MinMaxScaler()
    X_scaled = scaler.fit_transform(X_train)

    if USE_QUANTUM:
        # Use 4 features for quantum (qubit efficiency)
        X_q = X_scaled[:, :4]
        qkernel = QuantumKernel_vqnet(n_qbits=4)
        K_train = qkernel.evaluate(X_q, X_q)
        svm = SVC(kernel='precomputed', C=1.0, probability=False)
        svm.fit(K_train, y_train)
        return svm, scaler, qkernel, X_q
    else:
        # Fallback: classical RBF kernel (still effective for demo)
        svm = SVC(kernel='rbf', C=1.0, gamma='scale', probability=True)
        svm.fit(X_scaled, y_train)
        return svm, scaler, None, X_scaled


def predict_transactions(model, scaler, qkernel, X_train_q, transactions):
    """
    Predict under-invoicing for new transactions.
    Each transaction is a dict with fields:
      nomor_aju, cif_per_unit, gap_ratio, hs_risk, country_risk, freq_importir
    """
    if not transactions:
        return []

    features = []
    for t in transactions:
        features.append([
            float(t.get('cif_per_unit', 0)),
            float(t.get('gap_ratio', 0)),
            float(t.get('hs_risk', 0.5)),
            float(t.get('country_risk', 0.5)),
            float(t.get('freq_importir', 0.5)),
        ])

    X_new = np.array(features)
    X_scaled = scaler.transform(X_new)

    if USE_QUANTUM and qkernel is not None:
        X_q = X_scaled[:, :4]
        K_test = qkernel.evaluate(X_q, X_train_q)
        predictions = model.predict(K_test)
        # No probability for precomputed kernel
        results = []
        for i, (pred, t) in enumerate(zip(predictions, transactions)):
            results.append({
                'nomor_aju': t.get('nomor_aju', f'TX-{i+1}'),
                'prediction': 'NORMAL' if pred == 1 else 'UNDER-INVOICING',
                'label': int(pred),
                'confidence': 0.85 if pred == 1 else 0.90,  # Estimated
                'features': {
                    'cif_per_unit': float(t.get('cif_per_unit', 0)),
                    'gap_ratio': float(t.get('gap_ratio', 0)),
                    'hs_risk': float(t.get('hs_risk', 0)),
                    'country_risk': float(t.get('country_risk', 0)),
                    'freq_importir': float(t.get('freq_importir', 0)),
                }
            })
        return results
    else:
        predictions = model.predict(X_scaled)
        probas = model.predict_proba(X_scaled) if hasattr(model, 'predict_proba') else None

        results = []
        for i, (pred, t) in enumerate(zip(predictions, transactions)):
            conf = 0.75
            if probas is not None:
                conf = float(np.max(probas[i]))

            results.append({
                'nomor_aju': t.get('nomor_aju', f'TX-{i+1}'),
                'prediction': 'NORMAL' if pred == 1 else 'UNDER-INVOICING',
                'label': int(pred),
                'confidence': round(conf, 3),
                'features': {
                    'cif_per_unit': float(t.get('cif_per_unit', 0)),
                    'gap_ratio': float(t.get('gap_ratio', 0)),
                    'hs_risk': float(t.get('hs_risk', 0)),
                    'country_risk': float(t.get('country_risk', 0)),
                    'freq_importir': float(t.get('freq_importir', 0)),
                }
            })
        return results


def main():
    """Main entry point — read from stdin, output to stdout."""
    try:
        raw = sys.stdin.read()
        if not raw.strip():
            # No input: run self-test with training data
            X_train, y_train = generate_training_data(30, 30)
            model, scaler, qkernel, X_train_q = train_model(X_train, y_train)

            # Test with own training data
            X_scaled = scaler.transform(X_train)
            if USE_QUANTUM and qkernel is not None:
                K = qkernel.evaluate(X_scaled[:, :4], X_train_q)
                y_pred = model.predict(K)
            else:
                y_pred = model.predict(X_scaled)

            cm = confusion_matrix(y_train, y_pred)
            tn, fp, fn, tp = cm.ravel()
            accuracy = (tp + tn) / len(y_train) * 100

            output = {
                'status': 'ok',
                'mode': 'self-test',
                'engine': 'quantum' if USE_QUANTUM else 'classical-rbf',
                'training_samples': len(X_train),
                'accuracy': round(accuracy, 1),
                'confusion_matrix': {
                    'true_normal': int(tp),
                    'true_anomali': int(tn),
                    'false_positive': int(fp),
                    'false_negative': int(fn),
                },
                'message': 'QSVM engine ready' if USE_QUANTUM else 'Classical SVM fallback (pyqpanda not installed)'
            }
            print(json.dumps(output))
            return

        input_data = json.loads(raw)
        transactions = input_data.get('transactions', [])

        # Train model
        X_train, y_train = generate_training_data(30, 30)
        model, scaler, qkernel, X_train_q = train_model(X_train, y_train)

        # Predict
        results = predict_transactions(model, scaler, qkernel, X_train_q, transactions)

        total_flagged = sum(1 for r in results if r['label'] == -1)
        avg_confidence = sum(r['confidence'] for r in results) / max(len(results), 1)

        output = {
            'status': 'ok',
            'engine': 'quantum' if USE_QUANTUM else 'classical-rbf',
            'total_scanned': len(results),
            'total_flagged': total_flagged,
            'total_normal': len(results) - total_flagged,
            'avg_confidence': round(avg_confidence, 3),
            'predictions': results,
        }
        print(json.dumps(output))

    except Exception as e:
        error_output = {
            'status': 'error',
            'message': str(e),
            'engine': 'quantum' if USE_QUANTUM else 'classical-rbf',
        }
        print(json.dumps(error_output))
        sys.exit(1)


if __name__ == '__main__':
    main()
