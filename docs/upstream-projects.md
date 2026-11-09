# Progetti di riferimento

## Condor

Repository consultato: https://github.com/hummingbot/condor

Condor è stato valutato per studiarne l'organizzazione della dashboard, la gerarchia delle informazioni e l'esperienza d'uso. Non viene incluso come submodule, dipendenza o runtime di Miracolo.

La scelta è mantenere una sola interfaccia Miracolo e un solo percorso di esecuzione, evitando di introdurre Hummingbot come secondo motore.

## Alpaca

Alpaca PAPER è l'unico broker previsto per la prima versione. Il client è fissato al dominio Paper e supporta gli asset crypto esplicitamente autorizzati e verificati come negoziabili dal broker.

## Possibili integrazioni future

Fonti di mercato, modelli AI e strumenti di analisi potranno essere aggiunti soltanto come componenti di lettura e proposta. Non avranno credenziali broker e non potranno inviare ordini direttamente. Ogni proposta dovrà passare dal Risk Gateway.
